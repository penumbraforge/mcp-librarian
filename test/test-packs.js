import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('packs', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'mcp-packs-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('validates pack.json manifest', async () => {
    const { validatePackManifest } = await import('../src/cli/packs.js');
    const valid = { name: 'test-pack', description: 'Test', skills: ['skill-a'] };
    assert.equal(validatePackManifest(valid).valid, true);
  });

  it('rejects pack.json without name', async () => {
    const { validatePackManifest } = await import('../src/cli/packs.js');
    const invalid = { description: 'Test', skills: ['skill-a'] };
    assert.equal(validatePackManifest(invalid).valid, false);
  });

  it('copyPackSkills copies skills to packs dir', async () => {
    const { copyPackSkills } = await import('../src/cli/packs.js');
    const srcDir = join(tempDir, 'src', 'skills');
    const destDir = join(tempDir, 'packs', 'test-pack', 'skills');
    mkdirSync(join(srcDir, 'my-skill'), { recursive: true });
    writeFileSync(join(srcDir, 'my-skill', 'SKILL.md'), '---\nname: my-skill\ndescription: "test"\n---\n## X\nContent');
    await copyPackSkills(srcDir, destDir);
    assert.ok(existsSync(join(destDir, 'my-skill', 'SKILL.md')));
  });
});
