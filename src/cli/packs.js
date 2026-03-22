/**
 * GitHub-based skill pack management.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { getPacksDir, getSkillsDir, getLibDir } from './paths.js';
import { signAllSkills } from './setup.js';
import { guardContent } from '../librarian/content-guard.js';
import { parseSkill } from '../store/parser.js';
import { validateSkill } from '../librarian/validator.js';

export function validatePackManifest(manifest) {
  const issues = [];
  if (!manifest.name) issues.push('Missing required field: name');
  if (!manifest.description) issues.push('Missing required field: description');
  if (!manifest.skills || !Array.isArray(manifest.skills) || manifest.skills.length === 0) {
    issues.push('Missing or empty skills array');
  }
  return { valid: issues.length === 0, issues };
}

export async function copyPackSkills(srcSkillsDir, destSkillsDir) {
  mkdirSync(destSkillsDir, { recursive: true });
  const entries = readdirSync(srcSkillsDir, { withFileTypes: true });
  let count = 0;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const srcSkill = join(srcSkillsDir, entry.name, 'SKILL.md');
    if (!existsSync(srcSkill)) continue;

    const destDir = join(destSkillsDir, entry.name);
    mkdirSync(destDir, { recursive: true });
    cpSync(srcSkill, join(destDir, 'SKILL.md'));
    count++;
  }

  return count;
}

export async function installPack(repoRef) {
  const [repo, branch] = repoRef.split('#');
  const packsDir = getPacksDir();
  const packName = repo.split('/').pop();

  console.log(`\nInstalling pack: ${repo}...`);

  const tempDir = mkdtempSync(join(tmpdir(), 'mcp-pack-'));
  try {
    const branchFlag = branch ? `--branch ${branch}` : '';
    execSync(`git clone --depth 1 ${branchFlag} https://github.com/${repo}.git "${tempDir}"`, { stdio: 'pipe' });

    const manifestPath = join(tempDir, 'pack.json');
    if (!existsSync(manifestPath)) {
      throw new Error('No pack.json found in repository');
    }

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const validation = validatePackManifest(manifest);
    if (!validation.valid) {
      throw new Error(`Invalid pack.json: ${validation.issues.join(', ')}`);
    }

    const srcSkills = join(tempDir, 'skills');
    if (!existsSync(srcSkills)) {
      throw new Error('No skills/ directory found in repository');
    }

    // Validate and guard each skill
    for (const entry of readdirSync(srcSkills, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skillPath = join(srcSkills, entry.name, 'SKILL.md');
      if (!existsSync(skillPath)) continue;
      const content = readFileSync(skillPath, 'utf8');

      const parsed = parseSkill(content, entry.name);
      parsed._raw = content;
      const skillValidation = validateSkill(parsed);
      if (!skillValidation.valid) {
        throw new Error(`Invalid skill ${entry.name}: ${skillValidation.issues.map(i => i.message).join(', ')}`);
      }

      const guardResult = guardContent(content);
      if (!guardResult.safe) {
        const reasons = guardResult.issues
          .filter(i => i.severity === 'error')
          .map(i => i.message)
          .join('; ');
        throw new Error(`Skill ${entry.name} blocked by content guard: ${reasons}`);
      }
    }

    const destDir = join(packsDir, packName);
    mkdirSync(destDir, { recursive: true });
    cpSync(manifestPath, join(destDir, 'pack.json'));
    writeFileSync(join(destDir, '.source'), repoRef);

    const destSkills = join(destDir, 'skills');
    const count = await copyPackSkills(srcSkills, destSkills);

    const libDir = getLibDir();
    await signAllSkills(libDir, getSkillsDir(), packsDir);

    console.log(`  Installed ${count} skills from ${packName}`);
    console.log('  Restart the server to pick up new skills: mcp-librarian restart');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

export async function updatePack(packName) {
  const packsDir = getPacksDir();
  const packDir = join(packsDir, packName);

  if (!existsSync(packDir)) {
    console.error(`Pack not found: ${packName}`);
    process.exit(1);
  }

  const sourcePath = join(packDir, '.source');
  if (!existsSync(sourcePath)) {
    console.error(`No source reference found for ${packName}. Reinstall with install-pack.`);
    process.exit(1);
  }

  const repoRef = readFileSync(sourcePath, 'utf8').trim();
  rmSync(packDir, { recursive: true, force: true });
  await installPack(repoRef);
}

export async function listPacks() {
  const packsDir = getPacksDir();

  if (!existsSync(packsDir)) {
    console.log('No packs installed.');
    return;
  }

  const entries = readdirSync(packsDir, { withFileTypes: true });
  const packs = entries.filter(e => e.isDirectory());

  if (packs.length === 0) {
    console.log('No packs installed.');
    return;
  }

  console.log(`\n  Installed packs:\n`);
  for (const pack of packs) {
    const manifestPath = join(packsDir, pack.name, 'pack.json');
    let desc = '';
    if (existsSync(manifestPath)) {
      try {
        const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
        desc = m.description || '';
      } catch {}
    }

    const skillsDir = join(packsDir, pack.name, 'skills');
    let skillCount = 0;
    if (existsSync(skillsDir)) {
      skillCount = readdirSync(skillsDir, { withFileTypes: true }).filter(e => e.isDirectory()).length;
    }

    console.log(`  \x1b[1m${pack.name}\x1b[0m (${skillCount} skills) — ${desc}`);
  }
  console.log('');
}

export async function removePack(packName) {
  const packsDir = getPacksDir();
  const packDir = join(packsDir, packName);

  if (!existsSync(packDir)) {
    console.error(`Pack not found: ${packName}`);
    process.exit(1);
  }

  rmSync(packDir, { recursive: true, force: true });

  const libDir = getLibDir();
  await signAllSkills(libDir, getSkillsDir(), packsDir);

  console.log(`Removed pack: ${packName}`);
  console.log('Restart the server to update index: mcp-librarian restart');
}

export async function exportPack(outputDir) {
  const skillsDir = getSkillsDir();

  if (!existsSync(skillsDir)) {
    console.error('No skills found. Run `mcp-librarian setup` first.');
    process.exit(1);
  }

  mkdirSync(join(outputDir, 'skills'), { recursive: true });

  const entries = readdirSync(skillsDir, { withFileTypes: true });
  const skillNames = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const srcSkill = join(skillsDir, entry.name, 'SKILL.md');
    if (!existsSync(srcSkill)) continue;

    const destDir = join(outputDir, 'skills', entry.name);
    mkdirSync(destDir, { recursive: true });
    cpSync(srcSkill, join(destDir, 'SKILL.md'));
    skillNames.push(entry.name);
  }

  const manifest = {
    name: 'my-pack',
    description: 'Exported skill pack',
    author: 'penumbraforge',
    skills: skillNames,
  };

  writeFileSync(join(outputDir, 'pack.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Exported ${skillNames.length} skills to ${outputDir}`);
  console.log('Edit pack.json to customize name/description, then push to GitHub.');
}
