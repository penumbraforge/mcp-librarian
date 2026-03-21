import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, rm, writeFile, symlink, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { validatePath } from '../src/security/path-guard.js';
import { McpError, ERROR_CODES } from '../src/errors.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function assertPathViolation(fn) {
  let threw = false;
  try {
    await fn();
  } catch (err) {
    threw = true;
    assert.ok(err instanceof McpError, `Expected McpError, got: ${err.constructor.name}: ${err.message}`);
    assert.strictEqual(err.code, ERROR_CODES.PATH_VIOLATION,
      `Expected PATH_VIOLATION (${ERROR_CODES.PATH_VIOLATION}), got code: ${err.code}`);
  }
  assert.ok(threw, 'Expected validatePath to throw McpError(PATH_VIOLATION) but it did not');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('path-guard', () => {
  let allowedDir;    // the "allowed" temp directory
  let outsideDir;    // a temp directory that is NOT allowed

  beforeEach(async () => {
    const base = join(tmpdir(), `mcp-pg-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    allowedDir = join(base, 'allowed');
    outsideDir = join(base, 'outside');
    await mkdir(allowedDir, { recursive: true });
    await mkdir(outsideDir, { recursive: true });

    // Create some real files
    await writeFile(join(allowedDir, 'good.txt'), 'hello');
    await writeFile(join(outsideDir, 'secret.txt'), 'secret');
  });

  afterEach(async () => {
    // Clean up everything under base (parent of allowedDir)
    const base = join(allowedDir, '..');
    await rm(base, { recursive: true, force: true });
  });

  // 1. Valid path within allowed dir → returns resolved path
  it('valid path within allowed dir → returns resolved path', async () => {
    const target = join(allowedDir, 'good.txt');
    const result = await validatePath(target, allowedDir);
    // Result should be the realpath of the target
    const expected = await realpath(target);
    assert.strictEqual(result, expected);
  });

  // 2. Null byte in path → throws PATH_VIOLATION
  it('null byte in path → throws PATH_VIOLATION', async () => {
    const malicious = join(allowedDir, 'good.txt\x00.evil');
    await assertPathViolation(() => validatePath(malicious, allowedDir));
  });

  // 3. ../ traversal → throws PATH_VIOLATION
  it('../ traversal sequence in path → throws PATH_VIOLATION', async () => {
    const traversal = join(allowedDir, '../outside/secret.txt');
    await assertPathViolation(() => validatePath(traversal, allowedDir));
  });

  it('encoded ../ traversal in path → throws PATH_VIOLATION', async () => {
    // Even if the path resolves outside, it should be caught by realpath check
    const traversal = allowedDir + '/../outside/secret.txt';
    await assertPathViolation(() => validatePath(traversal, allowedDir));
  });

  // 4. Absolute path outside allowed dir → throws PATH_VIOLATION
  it('absolute path outside allowed dir → throws PATH_VIOLATION', async () => {
    const outside = join(outsideDir, 'secret.txt');
    await assertPathViolation(() => validatePath(outside, allowedDir));
  });

  it('/tmp path when allowed dir is elsewhere → throws PATH_VIOLATION', async () => {
    await assertPathViolation(() => validatePath('/tmp/evil.txt', allowedDir));
  });

  // 5. Symlink pointing outside allowed dir → throws PATH_VIOLATION
  it('symlink pointing outside allowed dir → throws PATH_VIOLATION', async () => {
    const linkPath = join(allowedDir, 'evil-link.txt');
    const target   = join(outsideDir, 'secret.txt');
    await symlink(target, linkPath);

    await assertPathViolation(() => validatePath(linkPath, allowedDir));
  });

  it('symlink chain pointing outside allowed dir → throws PATH_VIOLATION', async () => {
    // link1 → link2 → outside/secret.txt
    const link2 = join(allowedDir, 'link2.txt');
    const link1 = join(allowedDir, 'link1.txt');
    const target = join(outsideDir, 'secret.txt');

    await symlink(target, link2);
    await symlink(link2, link1);

    await assertPathViolation(() => validatePath(link1, allowedDir));
  });

  // 6. Symlink pointing inside allowed dir → OK (returns resolved path)
  it('symlink pointing inside allowed dir → returns resolved path', async () => {
    // Create a file inside allowed dir, then a symlink to it also inside allowed dir
    const realFile = join(allowedDir, 'real.txt');
    await writeFile(realFile, 'data');

    const linkPath = join(allowedDir, 'link-to-real.txt');
    await symlink(realFile, linkPath);

    const result = await validatePath(linkPath, allowedDir);
    // Should resolve to the real file path
    const expected = await realpath(realFile);
    assert.strictEqual(result, expected);
  });

  // 7. Path that is exactly the allowed dir itself
  it('path equal to allowedDir itself → returns resolved path', async () => {
    const result = await validatePath(allowedDir, allowedDir);
    const expected = await realpath(allowedDir);
    assert.strictEqual(result, expected);
  });

  // 8. Nested valid path
  it('deeply nested valid path → returns resolved path', async () => {
    const nested = join(allowedDir, 'a', 'b', 'c');
    await mkdir(nested, { recursive: true });
    await writeFile(join(nested, 'file.txt'), 'data');

    const target = join(nested, 'file.txt');
    const result = await validatePath(target, allowedDir);
    const expected = await realpath(target);
    assert.strictEqual(result, expected);
  });

});
