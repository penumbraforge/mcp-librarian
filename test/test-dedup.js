import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeHash, checkDuplicate } from '../src/store/dedup.js';

describe('computeHash', () => {
  it('returns a 64-character hex string', () => {
    const hash = computeHash('hello world');
    assert.equal(typeof hash, 'string');
    assert.equal(hash.length, 64);
    assert.ok(/^[0-9a-f]{64}$/.test(hash), 'Should be lowercase hex');
  });

  it('same content produces same hash', () => {
    const content = 'The quick brown fox jumps over the lazy dog.';
    assert.equal(computeHash(content), computeHash(content));
  });

  it('different content produces different hash', () => {
    const hashA = computeHash('content A');
    const hashB = computeHash('content B');
    assert.notEqual(hashA, hashB);
  });

  it('empty string produces consistent hash', () => {
    const hash1 = computeHash('');
    const hash2 = computeHash('');
    assert.equal(hash1, hash2);
    assert.equal(hash1.length, 64);
  });

  it('whitespace differences produce different hashes', () => {
    assert.notEqual(computeHash('hello world'), computeHash('hello  world'));
  });
});

describe('checkDuplicate', () => {
  const makeExistingSkills = (entries) => {
    const map = new Map();
    for (const [filename, data] of entries) {
      map.set(filename, data);
    }
    return map;
  };

  it('exact content match → { action: "skip" }', () => {
    const content = '# My Skill\nSome content here.';
    const hash = computeHash(content);
    const existing = makeExistingSkills([
      ['my-skill.md', { name: 'my-skill', hash }],
    ]);
    const result = checkDuplicate(content, 'my-skill', existing);
    assert.deepEqual(result, { action: 'skip' });
  });

  it('same name but different content → { action: "update", replaces: filename }', () => {
    const oldContent = '# My Skill\nOld content.';
    const newContent = '# My Skill\nNew and improved content.';
    const oldHash = computeHash(oldContent);
    const existing = makeExistingSkills([
      ['my-skill.md', { name: 'my-skill', hash: oldHash }],
    ]);
    const result = checkDuplicate(newContent, 'my-skill', existing);
    assert.deepEqual(result, { action: 'update', replaces: 'my-skill.md' });
  });

  it('new skill → { action: "install" }', () => {
    const content = '# Brand New Skill\nFresh content.';
    const existing = makeExistingSkills([
      ['other-skill.md', { name: 'other-skill', hash: computeHash('other content') }],
    ]);
    const result = checkDuplicate(content, 'brand-new-skill', existing);
    assert.deepEqual(result, { action: 'install' });
  });

  it('empty existing skills map → { action: "install" }', () => {
    const content = '# My Skill\nContent here.';
    const existing = new Map();
    const result = checkDuplicate(content, 'my-skill', existing);
    assert.deepEqual(result, { action: 'install' });
  });

  it('exact hash match in different named file → { action: "skip" }', () => {
    const content = '# My Skill\nExact same content.';
    const hash = computeHash(content);
    // Same content hash but stored under a different filename/name
    const existing = makeExistingSkills([
      ['other-name.md', { name: 'other-name', hash }],
    ]);
    const result = checkDuplicate(content, 'my-skill', existing);
    assert.deepEqual(result, { action: 'skip' });
  });

  it('update replaces the correct filename', () => {
    const oldContent = '# Skill A\nVersion 1';
    const newContent = '# Skill A\nVersion 2';
    const existing = makeExistingSkills([
      ['skill-a_v1.md', { name: 'skill-a', hash: computeHash(oldContent) }],
      ['unrelated.md', { name: 'unrelated', hash: computeHash('unrelated content') }],
    ]);
    const result = checkDuplicate(newContent, 'skill-a', existing);
    assert.deepEqual(result, { action: 'update', replaces: 'skill-a_v1.md' });
  });
});
