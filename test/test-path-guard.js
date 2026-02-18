import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validatePath, sanitizeSkillName } from '../src/security/path-guard.js';
import { tmpdir } from 'node:os';
import { mkdirSync, symlinkSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

describe('Path Guard', () => {
  const base = join(tmpdir(), `pathguard-test-${randomBytes(4).toString('hex')}`);
  mkdirSync(base, { recursive: true });

  it('should allow valid paths within base', () => {
    const result = validatePath('subdir/file.md', base);
    assert.ok(result.includes('subdir'));
  });

  it('should block null bytes', () => {
    assert.throws(() => validatePath('file\x00.md', base), /null bytes/);
  });

  it('should block directory traversal', () => {
    assert.throws(() => validatePath('../../etc/passwd', base), /escapes/);
  });

  it('should block .. in middle', () => {
    assert.throws(() => validatePath('skills/../../../etc/passwd', base), /escapes/);
  });

  it('should block symlinks pointing outside base', () => {
    const linkPath = join(base, 'evil-link');
    try {
      if (existsSync(linkPath)) rmSync(linkPath);
      symlinkSync('/etc/passwd', linkPath);
      assert.throws(() => validatePath('evil-link', base), /escapes|symlink/i);
    } finally {
      if (existsSync(linkPath)) rmSync(linkPath);
    }
  });

  it('should block intermediate directory symlinks', () => {
    const subdir = join(base, 'legit-dir');
    const linkDir = join(base, 'link-dir');
    mkdirSync(subdir, { recursive: true });
    try {
      if (existsSync(linkDir)) rmSync(linkDir);
      symlinkSync('/tmp', linkDir);
      assert.throws(() => validatePath('link-dir/something', base), /escapes|symlink/i);
    } finally {
      if (existsSync(linkDir)) rmSync(linkDir);
    }
  });
});

describe('Skill Name Sanitizer', () => {
  it('should accept valid names', () => {
    assert.equal(sanitizeSkillName('automation'), 'automation');
    assert.equal(sanitizeSkillName('red-team'), 'red-team');
    assert.equal(sanitizeSkillName('skill_v2'), 'skill_v2');
  });

  it('should reject invalid characters', () => {
    assert.throws(() => sanitizeSkillName('../../bad'));
    assert.throws(() => sanitizeSkillName('skill name'));
    assert.throws(() => sanitizeSkillName('skill/path'));
  });

  it('should reject null bytes', () => {
    assert.throws(() => sanitizeSkillName('skill\x00'));
  });

  it('should reject too-long names', () => {
    assert.throws(() => sanitizeSkillName('a'.repeat(65)));
  });

  it('should reject non-strings', () => {
    assert.throws(() => sanitizeSkillName(123));
    assert.throws(() => sanitizeSkillName(null));
  });
});
