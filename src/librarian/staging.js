/**
 * Staging area: draft → review → promote.
 * AI output goes here first, never directly to live.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, unlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { parseSkill } from '../store/parser.js';
import { validateSkill } from './validator.js';
import { guardContent } from './content-guard.js';
import { sanitizeSkillName } from '../security/path-guard.js';

export class StagingArea {
  constructor(stagingDir, skillsDir) {
    this.stagingDir = stagingDir;
    this.skillsDir = skillsDir;
    mkdirSync(stagingDir, { recursive: true });
  }

  stage(skillName, content) {
    const safeName = sanitizeSkillName(skillName);
    skillName = safeName;
    const guard = guardContent(content);
    if (!guard.safe) {
      return { staged: false, issues: guard.issues };
    }

    const parsed = parseSkill(content, skillName);
    parsed._raw = content;
    const validation = validateSkill(parsed);
    if (!validation.valid) {
      return { staged: false, issues: validation.issues };
    }

    const skillDir = join(this.stagingDir, skillName);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), content, { mode: 0o644 });
    writeFileSync(join(skillDir, 'staged.json'), JSON.stringify({
      stagedAt: new Date().toISOString(),
      validation,
      guard,
    }, null, 2), { mode: 0o644 });

    return { staged: true, issues: validation.issues };
  }

  list() {
    if (!existsSync(this.stagingDir)) return [];
    return readdirSync(this.stagingDir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => {
        const metaPath = join(this.stagingDir, e.name, 'staged.json');
        let meta = {};
        try { meta = JSON.parse(readFileSync(metaPath, 'utf8')); } catch {}
        return { name: e.name, ...meta };
      });
  }

  getStagedContent(skillName) {
    const safeName = sanitizeSkillName(skillName);
    const path = join(this.stagingDir, safeName, 'SKILL.md');
    if (!existsSync(path)) return null;
    return readFileSync(path, 'utf8');
  }

  getLiveDiff(skillName) {
    const safeName = sanitizeSkillName(skillName);
    const staged = this.getStagedContent(safeName);
    if (!staged) return null;

    const livePath = join(this.skillsDir, safeName, 'SKILL.md');
    const live = existsSync(livePath) ? readFileSync(livePath, 'utf8') : null;

    return {
      skill: skillName,
      isNew: !live,
      staged: staged.slice(0, 2000),
      live: live?.slice(0, 2000) || null,
    };
  }

  promoteToLive(skillName) {
    const safeName = sanitizeSkillName(skillName);
    skillName = safeName;
    const staged = this.getStagedContent(skillName);
    if (!staged) throw new Error(`No staged content for "${skillName}"`);

    // Final guard check
    const guard = guardContent(staged);
    if (!guard.safe) {
      throw new Error(`Content guard failed on promotion: ${guard.issues.map(i => i.message).join(', ')}`);
    }

    const liveDir = join(this.skillsDir, skillName);
    mkdirSync(liveDir, { recursive: true });
    writeFileSync(join(liveDir, 'SKILL.md'), staged, { mode: 0o644 });

    // Clean staging
    this._removeStaged(skillName);

    return { promoted: true, skill: skillName };
  }

  _removeStaged(skillName) {
    const dir = join(this.stagingDir, skillName);
    if (!existsSync(dir)) return;
    rmSync(dir, { recursive: true, force: true });
  }
}
