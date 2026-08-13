#!/usr/bin/env node
/**
 * migrate.js — convert an old-lineage skills layout to the canonical flat one.
 *
 * The UDS lineage stored skills as ~/.mcp-librarian/skills/<name>/SKILL.md.
 * This server uses the flat ~/.mcp-librarian/skills/<name>.md. If both server
 * generations ever shared a home, the flat loader silently ignores the
 * subdirectories. Run this once to migrate:
 *
 *   node bin/migrate.js            # migrate ~/.mcp-librarian
 *   MCP_LIBRARIAN_HOME=/path node bin/migrate.js
 *
 * Idempotent and non-destructive: on a filename collision the file with the
 * newer mtime wins and the older is left in place with a warning. Nothing is
 * deleted.
 */

import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

const home = process.env.MCP_LIBRARIAN_HOME || join(homedir(), '.mcp-librarian');
const skillsDir = join(home, 'skills');

async function main() {
  let entries;
  try {
    entries = await readdir(skillsDir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') {
      process.stdout.write(`No skills directory at ${skillsDir} — nothing to migrate.\n`);
      return;
    }
    throw err;
  }

  const subdirs = entries.filter(e => e.isDirectory());
  if (subdirs.length === 0) {
    process.stdout.write('Already flat layout — nothing to migrate.\n');
    return;
  }

  let migrated = 0;
  let skipped = 0;

  for (const dir of subdirs) {
    const skillMd = join(skillsDir, dir.name, 'SKILL.md');
    let content;
    try {
      content = await readFile(skillMd, 'utf8');
    } catch {
      process.stdout.write(`  skip ${dir.name}/ — no SKILL.md\n`);
      continue;
    }

    const flatPath = join(skillsDir, `${dir.name}.md`);
    let existing = null;
    try {
      existing = await stat(flatPath);
    } catch { /* no collision */ }

    if (existing) {
      const srcStat = await stat(skillMd);
      if (existing.mtimeMs >= srcStat.mtimeMs) {
        process.stdout.write(`  skip ${dir.name} — flat file is newer, leaving both in place\n`);
        skipped++;
        continue;
      }
    }

    await writeFile(flatPath, content, 'utf8');
    process.stdout.write(`  migrated ${dir.name}/SKILL.md → ${dir.name}.md\n`);
    migrated++;
  }

  process.stdout.write(
    `\nDone: ${migrated} migrated, ${skipped} skipped. ` +
    `Old <name>/SKILL.md directories were left untouched — delete them once you've verified the flat files.\n`
  );
}

main().catch((err) => {
  process.stderr.write(`Migration failed: ${err.message}\n`);
  process.exit(1);
});
