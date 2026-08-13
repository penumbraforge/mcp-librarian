/**
 * SkillStore — coordinates BM25 indexing, LRU caching, dedup, and integrity
 * verification for skill markdown files.
 */

import { readdir, readFile, writeFile, unlink, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { BM25Index, parseSkillSections } from './bm25.js';
import { LRUCache } from './lru-cache.js';
import { loadManifest, verifySkill } from '../security/ed25519.js';
import { validateNewPath } from '../security/path-guard.js';
import { scoreSkill } from './quality-scorer.js';

// ---------------------------------------------------------------------------
// Frontmatter parsing
// ---------------------------------------------------------------------------

/**
 * Parse YAML-lite frontmatter from skill content.
 * Only handles: name, version, category (array), description.
 *
 * @param {string} content
 * @returns {{ name: string|null, version: string|null, categories: string[], description: string|null }}
 */
function parseFrontmatter(content) {
  const result = {
    name: null,
    version: null,
    categories: [],
    description: null,
    sources: [],
  };

  // Split on --- delimiter: parts[0] = before opening ---, parts[1] = frontmatter block
  const parts = content.split('---');
  if (parts.length < 3) return result;

  const block = parts[1];

  for (const line of block.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    const rawValue = trimmed.slice(colonIdx + 1).trim();

    switch (key) {
      case 'name':
        result.name = rawValue;
        break;

      case 'version':
        result.version = rawValue;
        break;

      case 'description':
        result.description = rawValue;
        break;

      case 'category': {
        // Parse bracket syntax: [a, b, c]
        const inner = rawValue.replace(/^\[/, '').replace(/\]$/, '');
        result.categories = inner
          .split(',')
          .map(s => s.trim())
          .filter(s => s.length > 0);
        break;
      }

      case 'sources': {
        // Bracket list of URLs, used by quality-weighted retrieval to score
        // source authority. Same syntax as category.
        const inner = rawValue.replace(/^\[/, '').replace(/\]$/, '');
        result.sources = inner
          .split(',')
          .map(s => s.trim().replace(/^["']|["']$/g, ''))
          .filter(s => s.length > 0);
        break;
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// SkillStore
// ---------------------------------------------------------------------------

export class SkillStore {
  /** @type {Map<string, { filename: string, frontmatter: object, integrity: string, hash: string|null, signedAt: string|null }>} */
  #skills;

  /** @type {BM25Index} */
  #index;

  /** @type {LRUCache} */
  #cache;

  /** @type {object} */
  #config;

  /** @type {string} */
  #skillsDir;

  /** @type {string} */
  #manifestPath;

  /** @type {boolean} */
  #qualityWeighting;

  /** @type {number} */
  #qualityWeight;

  constructor(config) {
    this.#config = config;
    this.#skillsDir = join(config.home, 'skills');
    this.#manifestPath = join(config.home, 'manifest.json');
    this.#skills = new Map();
    this.#index = new BM25Index();
    this.#cache = new LRUCache({
      maxSize: config.cacheSize ?? 100,
      ttlMs: config.cacheTtl ?? 300_000,
    });
    // Quality-weighted retrieval config. Off → pure BM25 (identical to the
    // pre-port behavior). qualityWeight clamped to [0, 1].
    this.#qualityWeighting = config.qualityWeighting !== false;
    this.#qualityWeight = Math.min(1, Math.max(0, config.qualityWeight ?? 0.4));
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Scan skills dir for .md files, parse frontmatter, build BM25 index,
   * verify integrity from manifest, handle dedup (same name → keep newer).
   */
  async load() {
    // Load manifest for integrity checks (skeleton if absent)
    const manifest = await loadManifest(this.#manifestPath);

    // Read all .md files from skills dir
    let entries;
    try {
      entries = await readdir(this.#skillsDir);
    } catch (err) {
      if (err.code === 'ENOENT') {
        entries = [];
      } else {
        throw err;
      }
    }

    const mdFiles = entries.filter(f => f.endsWith('.md'));

    // Collect raw skill data — we need mtimes for dedup
    const rawSkills = [];

    for (const filename of mdFiles) {
      const filePath = join(this.#skillsDir, filename);
      const [content, fileStat] = await Promise.all([
        readFile(filePath, 'utf8'),
        stat(filePath),
      ]);

      const frontmatter = parseFrontmatter(content);
      const name = frontmatter.name ?? filename.replace(/\.md$/, '');

      rawSkills.push({
        filename,
        filePath,
        content,
        frontmatter: { ...frontmatter, name },
        mtime: fileStat.mtimeMs,
      });
    }

    // Dedup: if two files share the same name, keep newer by mtime.
    // Sort oldest-first so the newest entry wins on Map.set.
    rawSkills.sort((a, b) => a.mtime - b.mtime);

    // Determine winner for each name (last one set in the map wins = newest)
    const winnerByName = new Map(); // name → skill entry
    for (const skill of rawSkills) {
      const { name } = skill.frontmatter;
      if (winnerByName.has(name)) {
        console.warn(
          `[SkillStore] Duplicate skill name "${name}": ` +
          `keeping ${skill.filename} (newer), discarding ${winnerByName.get(name).filename}`
        );
      }
      winnerByName.set(name, skill);
    }

    // Reset index and cache (but not skills — we rebuild them below)
    this.#skills.clear();
    this.#index.clear();
    this.#cache.clear();

    // Load public key once for integrity verification
    const publicKey = await this.#loadPublicKey();

    // Build skill map and BM25 index from winner skills
    for (const [name, skill] of winnerByName) {
      const manifestEntry = manifest.skills?.[name] ?? null;
      let integrity = 'UNSIGNED';
      let hash = null;
      let signedAt = null;

      if (manifestEntry && publicKey) {
        integrity = await verifySkill(skill.content, manifestEntry, publicKey);
        hash = manifestEntry.hash ?? null;
        signedAt = manifestEntry.signedAt ?? null;
      }

      // Parse sections once at load. Store the slug list in the authoritative
      // #skills map — NOT only in the LRU cache. The cache has a TTL and a
      // size cap; anything that reads sections from it (getSection,
      // getSectionSlugs, listSkills) silently returns empty after the cache
      // evicts, which quietly disables progressive disclosure on an idle
      // server. The map never expires.
      const sections = parseSkillSections(skill.content);

      // Compute quality once at load (µs/skill). Recomputing per load rather
      // than persisting to the manifest avoids the stale-score problem the
      // legacy lineage had.
      const quality = scoreSkill(skill.content, skill.frontmatter.sources);

      this.#skills.set(name, {
        filename: skill.filename,
        frontmatter: skill.frontmatter,
        integrity,
        hash,
        signedAt,
        sectionSlugs: sections.map(s => s.section),
        quality,
      });

      // Pre-populate content cache as a hot-path optimization only.
      this.#cache.set(name, skill.content);

      // Index skill metadata (name, description, categories) for search
      const metaText = [
        name,
        skill.frontmatter.description || '',
        ...(skill.frontmatter.categories || []),
      ].join(' ');
      this.#index.add(name, '_metadata', metaText);

      // Index skill content via BM25
      for (const { section, content: sectionContent } of sections) {
        this.#index.add(name, section, sectionContent);
      }
    }
  }

  /**
   * Search skills. BM25 relevance blended with per-skill quality when
   * quality-weighting is enabled.
   *
   * The blend keeps the BM25 index pure: it asks for extra raw results,
   * normalizes relevance to 0..1 by the max raw score, mixes in the skill's
   * quality (0..1), and re-sorts. `rawScore` is preserved on every result so
   * callers (find_and_load's no-match gate) can threshold on unblended
   * relevance — the blended score is always ~1.0 at the top and useless as a
   * match/no-match signal.
   *
   * @param {string} query
   * @param {number} [limit=10]
   * @returns {Array<{ skill, section, score, rawScore, quality, snippet }>}
   */
  search(query, limit = 10) {
    if (!this.#qualityWeighting || this.#qualityWeight === 0) {
      // Pure BM25 — still attach rawScore so callers have one uniform shape.
      return this.#index.search(query, limit).map(r => ({ ...r, rawScore: r.score, quality: this.#skills.get(r.skill)?.quality ?? 0 }));
    }

    // Over-fetch so quality can promote a slightly-less-relevant but much
    // higher-quality skill into the top `limit`.
    const raw = this.#index.search(query, Math.max(limit * 3, limit));
    if (raw.length === 0) return [];

    const maxRaw = raw[0].score || 1;
    const w = this.#qualityWeight;

    return raw
      .map(r => {
        const quality = this.#skills.get(r.skill)?.quality ?? 0;
        const normRelevance = maxRaw > 0 ? r.score / maxRaw : 0;
        const blended = (1 - w) * normRelevance + w * quality;
        return { ...r, rawScore: r.score, quality, score: blended };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * Return full skill content. Uses LRU cache.
   * @param {string} name
   * @returns {Promise<string|null>}
   */
  async getSkill(name) {
    // Check cache first
    const cached = this.#cache.get(name);
    if (cached !== undefined) return cached;

    const meta = this.#skills.get(name);
    if (!meta) return null;

    const filePath = join(this.#skillsDir, meta.filename);
    let content;
    try {
      content = await readFile(filePath, 'utf8');
    } catch {
      return null;
    }

    this.#cache.set(name, content);
    return content;
  }

  /**
   * Parse skill content and find a matching section by slug path.
   * Routes through getSkill(), which has a disk-read fallback, so this works
   * even after the LRU cache has evicted the content.
   * @param {string} name
   * @param {string} sectionPath  e.g. 'getting-started/installation'
   * @returns {Promise<string|null>}
   */
  async getSection(name, sectionPath) {
    const meta = this.#skills.get(name);
    if (!meta) return null;

    const content = await this.getSkill(name);
    if (content === null) return null;

    return this.#findSection(content, sectionPath);
  }

  /**
   * Return array of skill metadata.
   * @returns {Array<{ name, version, categories, description, integrity, filename }>}
   */
  listSkills() {
    return [...this.#skills.entries()].map(([name, meta]) => ({
      name,
      version: meta.frontmatter.version,
      categories: meta.frontmatter.categories,
      description: meta.frontmatter.description,
      integrity: meta.integrity,
      quality: meta.quality,
      filename: meta.filename,
      // Section slugs come from the authoritative map, not the LRU cache,
      // so they never go empty on an idle server.
      sections: meta.sectionSlugs ?? [],
    }));
  }

  /**
   * Return section slug paths for a skill (for load_section).
   * @param {string} name
   * @returns {string[]}
   */
  getSectionSlugs(name) {
    const meta = this.#skills.get(name);
    return meta?.sectionSlugs ?? [];
  }

  /**
   * Return detailed integrity status for a single skill.
   * @param {string} name
   * @returns {{ name, integrity, hash, signedAt, filename }|null}
   */
  skillStatus(name) {
    const meta = this.#skills.get(name);
    if (!meta) return null;

    return {
      name,
      integrity: meta.integrity,
      hash: meta.hash,
      signedAt: meta.signedAt,
      quality: meta.quality,
      filename: meta.filename,
    };
  }

  /**
   * Write a skill file to the skills dir. Uses path guard to prevent traversal.
   * @param {string} filename
   * @param {string} content
   */
  async addSkill(filename, content) {
    // Single source of truth for containment — path-guard, not a local copy.
    const targetPath = await validateNewPath(filename, this.#skillsDir);
    await writeFile(targetPath, content, 'utf8');
  }

  /**
   * Delete a skill file from skills dir.
   * @param {string} filename
   */
  async removeSkill(filename) {
    const targetPath = join(this.#skillsDir, filename);
    await unlink(targetPath);
  }

  /**
   * Clear index and cache, then reload everything.
   */
  async rebuild() {
    this.#skills.clear();
    this.#index.clear();
    this.#cache.clear();
    await this.load();
  }

  /**
   * Return skill count + BM25 index stats.
   * @returns {{ skillCount: number, chunkCount: number, uniqueTerms: number }}
   */
  stats() {
    return {
      skillCount: this.#skills.size,
      ...this.#index.stats(),
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Find section content by slug path within markdown content.
   * @param {string} content
   * @param {string} sectionPath
   * @returns {string|null}
   */
  #findSection(content, sectionPath) {
    const sections = parseSkillSections(content);
    const match = sections.find(s => s.section === sectionPath);
    return match ? match.content : null;
  }

  /**
   * Load the public key from the keys directory, if present.
   * Looks for any .pem file containing 'public' in the name.
   * @returns {Promise<string|null>}
   */
  async #loadPublicKey() {
    const keysDir = join(this.#config.home, 'keys');
    let keyFiles;
    try {
      keyFiles = await readdir(keysDir);
    } catch {
      return null;
    }

    const pubKeyFile = keyFiles.find(f =>
      f.endsWith('.pem') && f.includes('public')
    );

    if (!pubKeyFile) return null;

    try {
      return await readFile(join(keysDir, pubKeyFile), 'utf8');
    } catch {
      return null;
    }
  }

}
