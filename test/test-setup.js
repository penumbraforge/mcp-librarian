import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('setup', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'mcp-librarian-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('generates Ed25519 keypair', async () => {
    const { generateKeys } = await import('../src/cli/setup.js');
    await generateKeys(tempDir, {});
    assert.ok(existsSync(join(tempDir, 'ed25519.pub')));
    assert.ok(existsSync(join(tempDir, 'ed25519.priv')));
  });

  it('skips keygen if keys exist', async () => {
    const { generateKeys } = await import('../src/cli/setup.js');
    writeFileSync(join(tempDir, 'ed25519.pub'), 'existing');
    writeFileSync(join(tempDir, 'ed25519.priv'), 'existing');
    await generateKeys(tempDir, {});
    assert.equal(readFileSync(join(tempDir, 'ed25519.pub'), 'utf8'), 'existing');
  });

  it('regenerates keys with --force-keygen', async () => {
    const { generateKeys } = await import('../src/cli/setup.js');
    writeFileSync(join(tempDir, 'ed25519.pub'), 'existing');
    writeFileSync(join(tempDir, 'ed25519.priv'), 'existing');
    await generateKeys(tempDir, { 'force-keygen': true });
    assert.notEqual(readFileSync(join(tempDir, 'ed25519.pub'), 'utf8'), 'existing');
  });

  it('generates HMAC secrets', async () => {
    const { generateSecrets } = await import('../src/cli/setup.js');
    await generateSecrets(tempDir, {});
    assert.ok(existsSync(join(tempDir, 'client.secret')));
    assert.ok(existsSync(join(tempDir, 'librarian.secret')));
    assert.ok(existsSync(join(tempDir, 'audit.secret')));
    const secret = readFileSync(join(tempDir, 'client.secret'), 'utf8').trim();
    assert.equal(secret.length, 64);
    assert.match(secret, /^[0-9a-f]+$/);
  });

  it('copies bundled skills to target dir', async () => {
    const { copyBundledSkills } = await import('../src/cli/setup.js');
    const bundledDir = join(tempDir, 'bundled');
    const targetDir = join(tempDir, 'skills');
    mkdirSync(bundledDir);
    mkdirSync(join(bundledDir, 'test-skill'), { recursive: true });
    writeFileSync(join(bundledDir, 'test-skill', 'SKILL.md'), '---\nname: test\n---\n## X\nContent');
    await copyBundledSkills(bundledDir, targetDir);
    assert.ok(existsSync(join(targetDir, 'test-skill', 'SKILL.md')));
  });

  it('does not overwrite user-modified skills', async () => {
    const { copyBundledSkills } = await import('../src/cli/setup.js');
    const bundledDir = join(tempDir, 'bundled');
    const targetDir = join(tempDir, 'skills');
    mkdirSync(join(bundledDir, 'test-skill'), { recursive: true });
    mkdirSync(join(targetDir, 'test-skill'), { recursive: true });
    writeFileSync(join(bundledDir, 'test-skill', 'SKILL.md'), 'bundled version');
    writeFileSync(join(targetDir, 'test-skill', 'SKILL.md'), 'user modified version');
    await copyBundledSkills(bundledDir, targetDir);
    assert.equal(readFileSync(join(targetDir, 'test-skill', 'SKILL.md'), 'utf8'), 'user modified version');
  });
});
