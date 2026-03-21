/**
 * SkillStore — coordinates BM25 indexing, LRU caching, dedup, and integrity
 * verification for skill markdown files.
 */

import { readdir, readFile, writeFile, unlink, stat, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { BM25Index, parseSkillSections } from './bm25.js';
import { LRUCache } from './lru-cache.js';
import { McpError, ERROR_CODES } from '../errors.js';
import { loadManifest, verifySkill } from '../security/ed25519.js';

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

      this.#skills.set(name, {
        filename: skill.filename,
        frontmatter: skill.frontmatter,
        integrity,
        hash,
        signedAt,
      });

      // Pre-populate content cache so getSection works synchronously
      this.#cache.set(name, skill.content);

      // Index skill metadata (name, description, categories) for search
      const metaText = [
        name,
        skill.frontmatter.description || '',
        ...(skill.frontmatter.categories || []),
      ].join(' ');
      this.#index.add(name, '_metadata', metaText);

      // Index skill content via BM25
      const sections = parseSkillSections(skill.content);
      for (const { section, content: sectionContent } of sections) {
        this.#index.add(name, section, sectionContent);
      }
    }
  }

  /**
   * Delegate search to BM25 index.
   * @param {string} query
   * @param {number} [limit=10]
   * @returns {Array<{ skill, section, score, snippet }>}
   */
  search(query, limit = 10) {
    return this.#index.search(query, limit);
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
   * Content is read from cache (populated during load), so this is synchronous.
   * @param {string} name
   * @param {string} sectionPath  e.g. 'getting-started/installation'
   * @returns {string|null}
   */
  getSection(name, sectionPath) {
    const meta = this.#skills.get(name);
    if (!meta) return null;

    const content = this.#cache.get(name);
    if (content === undefined) return null;

    return this.#findSection(content, sectionPath);
  }

  /**
   * Return array of skill metadata.
   * @returns {Array<{ name, version, categories, description, integrity, filename }>}
   */
  listSkills() {
    return [...this.#skills.entries()].map(([name, meta]) => {
      // Include available section slugs so users know valid load_section paths
      const content = this.#cache.get(name);
      const sections = content ? parseSkillSections(content).map(s => s.section) : [];

      return {
        name,
        version: meta.frontmatter.version,
        categories: meta.frontmatter.categories,
        description: meta.frontmatter.description,
        integrity: meta.integrity,
        filename: meta.filename,
        sections,
      };
    });
  }

  /**
   * Return section slug paths for a skill (for load_section).
   * @param {string} name
   * @returns {string[]}
   */
  getSectionSlugs(name) {
    const content = this.#cache.get(name);
    if (content === undefined) return [];
    return parseSkillSections(content).map(s => s.section);
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
      filename: meta.filename,
    };
  }

  /**
   * Write a skill file to the skills dir. Uses path guard to prevent traversal.
   * @param {string} filename
   * @param {string} content
   */
  async addSkill(filename, content) {
    const targetPath = join(this.#skillsDir, filename);
    await this.#validateNewFilePath(targetPath);
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

  /**
   * Validate a new file path (file doesn't exist yet) stays within skills dir.
   * Uses null-byte check, traversal-sequence check, and resolved-prefix check.
   *
   * Because the file doesn't exist yet we can't realpath it directly. Instead
   * we realpath the parent directory (which must exist) and join the basename.
   * @param {string} targetPath
   */
  async #validateNewFilePath(targetPath) {
    if (targetPath.includes('\x00')) {
      throw new McpError(ERROR_CODES.PATH_VIOLATION, 'Path contains null byte', { targetPath });
    }
    if (targetPath.includes('../') || targetPath.includes('..\\')) {
      throw new McpError(ERROR_CODES.PATH_VIOLATION, 'Path contains traversal sequence', { targetPath });
    }

    // Resolve the skills dir via realpath (follows symlinks, canonical form)
    const resolvedSkillsDir = await realpath(this.#skillsDir);
    const normalizedDir = resolvedSkillsDir.endsWith('/')
      ? resolvedSkillsDir
      : resolvedSkillsDir + '/';

    // Realpath the parent of the target (skills dir must already exist).
    // Then reconstruct the canonical target path using the resolved parent.
    const { dirname, basename } = await import('node:path');
    const parentDir = dirname(targetPath);
    let resolvedParent;
    try {
      resolvedParent = await realpath(parentDir);
    } catch {
      // Parent doesn't exist — treat as a violation
      throw new McpError(ERROR_CODES.PATH_VIOLATION, 'Parent directory does not exist', {
        targetPath,
        parentDir,
      });
    }

    const resolvedTarget = join(resolvedParent, basename(targetPath));

    if (
      resolvedTarget !== resolvedSkillsDir &&
      !resolvedTarget.startsWith(normalizedDir)
    ) {
      throw new McpError(ERROR_CODES.PATH_VIOLATION, 'Path resolves outside allowed directory', {
        targetPath,
        resolvedTarget,
        allowedDir: resolvedSkillsDir,
      });
    }
  }
}
