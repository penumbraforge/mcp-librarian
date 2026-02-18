import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validatePath, sanitizeSkillName } from '../src/security/path-guard.js';
import { tmpdir } from 'node:os';

describe('Path Guard', () => {
  const base = tmpdir();

  it('should allow valid paths within base', () => {
    const result = validatePath('subdir/file.md', base);
    assert.ok(result.startsWith(base));
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
