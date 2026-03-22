/**
 * Scaffold a new skill in ~/.mcp-librarian/skills/.
 */

import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getSkillsDir } from './paths.js';
import { SKILL_TEMPLATE } from '../librarian/validator.js';
import { sanitizeSkillName } from '../security/path-guard.js';

export async function createSkill(name) {
  const safeName = sanitizeSkillName(name);
  const skillsDir = getSkillsDir();
  const skillDir = join(skillsDir, safeName);

  if (existsSync(skillDir)) {
    console.error(`Skill already exists: ${safeName}`);
    console.error(`Edit: ${join(skillDir, 'SKILL.md')}`);
    process.exit(1);
  }

  mkdirSync(skillDir, { recursive: true });

  const content = SKILL_TEMPLATE
    .replace('{{NAME}}', safeName)
    .replace('{{DESCRIPTION}}', `${safeName} reference`)
    .replace('{{DOMAIN}}', 'general');

  writeFileSync(join(skillDir, 'SKILL.md'), content);
  console.log(`Created: ${join(skillDir, 'SKILL.md')}`);
  console.log('Edit the file, then restart the server to pick it up.');
}
