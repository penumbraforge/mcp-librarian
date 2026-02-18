import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseSkill, extractSectionHeadings } from './parser.js';
import { LRUCache } from './cache.js';
import { BM25 } from './bm25.js';
import { sha256, verifySignature } from '../security/ed25519.js';
import { validatePath, sanitizeSkillName } from '../security/path-guard.js';

export class SkillStore {
  constructor(skillsDir, opts = {}) {
    this.skillsDir = skillsDir;
    this.publicKey = opts.publicKey || null;
    this.cache = new LRUCache({ maxSize: opts.cacheMaxSize ?? 100, ttlMs: opts.cacheTtl ?? 600_000 });
    this.bm25 = new BM25();
    this.skills = new Map();     // name → parsed skill
    this.manifest = null;        // manifest.json content
  }

  loadManifest() {
    const manifestPath = join(this.skillsDir, 'manifest.json');
    if (existsSync(manifestPath)) {
      this.manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } else {
      this.manifest = { skills: {} };
    }
  }

  loadAll() {
    this.skills.clear();
    this.cache.clear();
    this.loadManifest();

    const entries = readdirSync(this.skillsDir, { withFileTypes: true });
    const allSections = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillPath = join(this.skillsDir, entry.name, 'SKILL.md');
      if (!existsSync(skillPath)) continue;

      try {
        const name = sanitizeSkillName(entry.name);
        const content = readFileSync(skillPath, 'utf8');
        const parsed = parseSkill(content, name);
        parsed._raw = content;
        this.skills.set(name, parsed);
        allSections.push(...parsed.sections);
      } catch (e) {
        console.error(`[skill-store] Failed to load ${entry.name}: ${e.message}`);
      }
    }

    this.bm25.index(allSections);
    return this.skills.size;
  }

  verifySkill(name) {
    const parsed = this.skills.get(name);
    if (!parsed) return { status: 'NOT_FOUND' };
    if (!this.manifest?.skills?.[name]) return { status: 'UNSIGNED' };

    const entry = this.manifest.skills[name];
    const contentHash = sha256(parsed._raw);

    if (contentHash !== entry.sha256) {
      return { status: 'TAMPERED', expected: entry.sha256, actual: contentHash };
    }

    if (this.publicKey && entry.signature) {
      const sigValid = verifySignature(parsed._raw, entry.signature, this.publicKey);
      if (!sigValid) return { status: 'TAMPERED', reason: 'signature_invalid' };
    }

    return { status: 'VERIFIED', sha256: contentHash };
  }

  getSkill(name) {
    const safeName = sanitizeSkillName(name);
    const cached = this.cache.get(`skill:${safeName}`);
    if (cached) return cached;

    const parsed = this.skills.get(safeName);
    if (!parsed) return null;

    const verification = this.verifySkill(safeName);
    if (verification.status === 'TAMPERED') {
      throw new Error(`Skill '${safeName}' integrity check failed: ${verification.reason || 'hash mismatch'}`);
    }
    if (verification.status === 'UNSIGNED') {
      throw new Error(`Skill '${safeName}' is unsigned — run install.sh to sign all skills`);
    }

    this.cache.set(`skill:${safeName}`, parsed);
    return parsed;
  }

  getSection(skillName, heading) {
    const skill = this.getSkill(skillName);
    if (!skill) return null;

    const section = skill.sections.find(
      s => s.heading.toLowerCase() === heading.toLowerCase()
    );
    return section || null;
  }

  search(query, topK = 5) {
    return this.bm25.search(query, topK);
  }

  listSkills() {
    const result = [];
    for (const [name, parsed] of this.skills) {
      result.push({
        name,
        description: parsed.frontmatter.description || '',
        domain: parsed.frontmatter.domain || 'general',
        sections: extractSectionHeadings(parsed),
        status: this.verifySkill(name).status,
      });
    }
    return result;
  }

  rebuildIndex() {
    const allSections = [];
    for (const parsed of this.skills.values()) {
      allSections.push(...parsed.sections);
    }
    this.bm25.index(allSections);
  }
}
