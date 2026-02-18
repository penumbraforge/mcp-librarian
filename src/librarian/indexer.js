/**
 * Build manifest.json + BM25 index from skill files.
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseSkill } from '../store/parser.js';
import { sanitizeSkillName } from '../security/path-guard.js';

export function scanSkillsDir(skillsDir) {
  const results = {};
  const entries = readdirSync(skillsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillPath = join(skillsDir, entry.name, 'SKILL.md');
    if (!existsSync(skillPath)) continue;

    try {
      const name = sanitizeSkillName(entry.name);
      const content = readFileSync(skillPath, 'utf8');
      const parsed = parseSkill(content, name);
      parsed._raw = content;
      results[name] = { parsed, content, path: skillPath };
    } catch (e) {
      console.error(`[indexer] Skip ${entry.name}: ${e.message}`);
    }
  }

  return results;
}
