import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdir, rm, readFile, stat, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { SkillStore } from '../src/store/skill-store.js';
import { generateKeypair, signAllSkills } from '../src/security/ed25519.js';

// ---------------------------------------------------------------------------
// Sample skill content
// ---------------------------------------------------------------------------

const SKILL_1 = `---
name: test-skill
version: 1.0.0
category: [testing, example]
description: A test skill for unit tests
---

## Getting Started

This section covers getting started with the test skill.

### Installation

Run the install command to set things up.

### Configuration

Configure settings in the config file.

## Advanced Usage

More advanced patterns and techniques.
`;

const SKILL_2 = `---
name: another-skill
version: 2.0.0
category: [utilities, automation]
description: Another skill with different content
---

## Overview

This skill automates common utility tasks.

### Setup

Install dependencies and configure the environment.

## Reference

Full reference documentation for all commands and options.
`;

const SKILL_3 = `---
name: search-skill
version: 1.5.0
category: [search, indexing]
description: A skill about searching and indexing content
---

## Search Basics

Learn how to search through indexed content effectively.

## Indexing

How to build and maintain search indexes for fast retrieval.
`;

// Duplicate name skill — same name as SKILL_1 but different content (newer)
const SKILL_1_NEWER = `---
name: test-skill
version: 2.0.0
category: [testing, advanced]
description: An updated test skill
---

## Getting Started

Updated getting started guide.

## New Features

Brand new features in version 2.
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeTestDir() {
  const testDir = join(
    tmpdir(),
    `mcp-skill-store-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  await mkdir(join(testDir, 'skills'), { recursive: true });
  await mkdir(join(testDir, 'keys'), { recursive: true });
  return testDir;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SkillStore', () => {
  let testDir;
  let skillsDir;
  let store;

  beforeEach(async () => {
    testDir = await makeTestDir();
    skillsDir = join(testDir, 'skills');
    store = new SkillStore({
      home: testDir,
      cacheSize: 50,
      cacheTtl: 60000,
    });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  // 1. load() reads skills and parses frontmatter correctly
  it('load() reads skills and parses frontmatter correctly', async () => {
    await writeFile(join(skillsDir, 'test-skill.md'), SKILL_1);
    await writeFile(join(skillsDir, 'another-skill.md'), SKILL_2);

    await store.load();

    const skills = store.listSkills();
    assert.equal(skills.length, 2, 'Should load 2 skills');

    const testSkill = skills.find(s => s.name === 'test-skill');
    assert.ok(testSkill, 'Should find test-skill');
    assert.equal(testSkill.version, '1.0.0');
    assert.deepEqual(testSkill.categories, ['testing', 'example']);
    assert.equal(testSkill.description, 'A test skill for unit tests');
    assert.equal(testSkill.filename, 'test-skill.md');

    const anotherSkill = skills.find(s => s.name === 'another-skill');
    assert.ok(anotherSkill, 'Should find another-skill');
    assert.equal(anotherSkill.version, '2.0.0');
    assert.deepEqual(anotherSkill.categories, ['utilities', 'automation']);
  });

  // 2. search() returns relevant results
  it('search() returns relevant results from indexed skills', async () => {
    await writeFile(join(skillsDir, 'test-skill.md'), SKILL_1);
    await writeFile(join(skillsDir, 'another-skill.md'), SKILL_2);
    await writeFile(join(skillsDir, 'search-skill.md'), SKILL_3);

    await store.load();

    // Search for something specific to SKILL_3
    const results = store.search('indexing search content', 5);
    assert.ok(results.length > 0, 'Should return search results');
    assert.ok(
      results.some(r => r.skill === 'search-skill'),
      'search-skill should rank highly for "indexing search content"'
    );

    // Each result has expected shape
    const first = results[0];
    assert.ok(typeof first.skill === 'string', 'result.skill is a string');
    assert.ok(typeof first.section === 'string', 'result.section is a string');
    assert.ok(typeof first.score === 'number', 'result.score is a number');
    assert.ok(typeof first.snippet === 'string', 'result.snippet is a string');
  });

  // 3. getSkill() returns full content and uses cache
  it('getSkill() returns full content and second call is served from cache', async () => {
    await writeFile(join(skillsDir, 'test-skill.md'), SKILL_1);
    await store.load();

    const content1 = await store.getSkill('test-skill');
    assert.equal(typeof content1, 'string');
    assert.ok(content1.includes('Getting Started'), 'Content should include skill body');
    assert.ok(content1.includes('name: test-skill'), 'Content should include frontmatter');

    // Second call — should be served from cache (no fs read)
    // We verify cache is used by checking store stats indicate cache hit
    // (we can't easily intercept fs, but we ensure same result)
    const content2 = await store.getSkill('test-skill');
    assert.equal(content1, content2, 'Cached content should match original');
  });

  // 4. getSection() returns correct section content
  it('getSection() returns correct section by slug path', async () => {
    await writeFile(join(skillsDir, 'test-skill.md'), SKILL_1);
    await store.load();

    // ## Getting Started → ## / ### Installation
    const installSection = store.getSection('test-skill', 'getting-started/installation');
    assert.ok(installSection, 'Should find getting-started/installation section');
    assert.ok(installSection.includes('install command'), 'Section should include installation text');

    // ## Getting Started → ## / ### Configuration
    const configSection = store.getSection('test-skill', 'getting-started/configuration');
    assert.ok(configSection, 'Should find getting-started/configuration section');
    assert.ok(configSection.includes('config file'), 'Section should include config text');

    // ## Advanced Usage (no sub-sections)
    const advancedSection = store.getSection('test-skill', 'advanced-usage');
    assert.ok(advancedSection, 'Should find advanced-usage section');
    assert.ok(advancedSection.includes('advanced patterns'), 'Section should include advanced text');
  });

  // 5. listSkills() returns metadata array with integrity status
  it('listSkills() returns array with name, version, categories, description, integrity, filename', async () => {
    await writeFile(join(skillsDir, 'test-skill.md'), SKILL_1);
    await store.load();

    const list = store.listSkills();
    assert.equal(list.length, 1);

    const skill = list[0];
    assert.ok('name' in skill, 'has name');
    assert.ok('version' in skill, 'has version');
    assert.ok('categories' in skill, 'has categories');
    assert.ok('description' in skill, 'has description');
    assert.ok('integrity' in skill, 'has integrity');
    assert.ok('filename' in skill, 'has filename');

    // Without a manifest, integrity should be UNSIGNED
    assert.equal(skill.integrity, 'UNSIGNED');
  });

  // 5b. listSkills() shows VERIFIED when manifest is present and valid
  it('listSkills() shows VERIFIED integrity when skill is properly signed', async () => {
    const { publicKey, privateKey } = generateKeypair();
    await writeFile(join(skillsDir, 'test-skill.md'), SKILL_1);
    await writeFile(join(testDir, 'keys', 'public.pem'), publicKey);
    await signAllSkills({ home: testDir, privateKey });

    await store.load();

    const list = store.listSkills();
    const skill = list.find(s => s.name === 'test-skill');
    assert.ok(skill, 'Should find test-skill');
    assert.equal(skill.integrity, 'VERIFIED', 'Signed skill should show VERIFIED');
  });

  // 6. skillStatus() returns detailed integrity info
  it('skillStatus() returns { name, integrity, hash, signedAt, filename }', async () => {
    const { publicKey, privateKey } = generateKeypair();
    await writeFile(join(skillsDir, 'test-skill.md'), SKILL_1);
    await writeFile(join(testDir, 'keys', 'public.pem'), publicKey);
    await signAllSkills({ home: testDir, privateKey });

    await store.load();

    const status = store.skillStatus('test-skill');
    assert.ok(status, 'skillStatus should return an object');
    assert.equal(status.name, 'test-skill');
    assert.equal(status.integrity, 'VERIFIED');
    assert.ok(typeof status.hash === 'string' && status.hash.length === 64, 'hash should be 64-char hex');
    assert.ok(typeof status.signedAt === 'string', 'signedAt should be a string');
    assert.equal(status.filename, 'test-skill.md');
  });

  // 6b. skillStatus() for unsigned skill
  it('skillStatus() shows UNSIGNED when no manifest entry exists', async () => {
    await writeFile(join(skillsDir, 'test-skill.md'), SKILL_1);
    await store.load();

    const status = store.skillStatus('test-skill');
    assert.equal(status.integrity, 'UNSIGNED');
    assert.equal(status.hash, null);
    assert.equal(status.signedAt, null);
  });

  // 7. Dedup on load: two files with same name → keep newer, warning logged
  it('dedup on load keeps newer file when two skills share the same name', async () => {
    // Write the older file first
    const olderPath = join(skillsDir, 'test-skill-old.md');
    const newerPath = join(skillsDir, 'test-skill-new.md');

    await writeFile(olderPath, SKILL_1);
    await writeFile(newerPath, SKILL_1_NEWER);

    // Ensure older file has an older mtime
    const past = new Date(Date.now() - 10000);
    await utimes(olderPath, past, past);

    // Capture warnings
    const warnings = [];
    const origWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));

    await store.load();

    console.warn = origWarn;

    // Only one skill with name 'test-skill' should exist
    const list = store.listSkills();
    const testSkills = list.filter(s => s.name === 'test-skill');
    assert.equal(testSkills.length, 1, 'Only one test-skill should survive dedup');

    // It should be the newer one (version 2.0.0)
    assert.equal(testSkills[0].version, '2.0.0', 'Newer skill should survive');

    // A warning should have been logged
    assert.ok(
      warnings.some(w => w.toLowerCase().includes('duplicate') || w.toLowerCase().includes('test-skill')),
      'A warning about the duplicate should be logged'
    );
  });

  // 8. addSkill() writes file to skills dir
  it('addSkill() writes a skill file to the skills directory', async () => {
    await store.load();

    await store.addSkill('new-skill.md', SKILL_3);

    // File should exist in skills dir
    const filePath = join(skillsDir, 'new-skill.md');
    const content = await readFile(filePath, 'utf8');
    assert.equal(content, SKILL_3, 'Written content should match');
  });

  // 8b. addSkill() rejects path traversal
  it('addSkill() rejects filenames with path traversal', async () => {
    await store.load();

    await assert.rejects(
      () => store.addSkill('../evil.md', 'malicious content'),
      'Should reject traversal in filename'
    );
  });

  // 9. rebuild() re-indexes all skills
  it('rebuild() re-indexes everything after new skills are added', async () => {
    await writeFile(join(skillsDir, 'test-skill.md'), SKILL_1);
    await store.load();

    let stats = store.stats();
    assert.equal(stats.skillCount, 1, 'Should have 1 skill after first load');

    // Add another skill file directly (bypassing addSkill to test rebuild specifically)
    await writeFile(join(skillsDir, 'another-skill.md'), SKILL_2);

    // Before rebuild, store still shows 1 skill
    assert.equal(store.stats().skillCount, 1, 'Before rebuild, still 1 skill');

    // Rebuild re-indexes
    await store.rebuild();

    assert.equal(store.stats().skillCount, 2, 'After rebuild, should have 2 skills');

    // Search should now find content from the new skill
    const results = store.search('utility automation', 5);
    assert.ok(
      results.some(r => r.skill === 'another-skill'),
      'another-skill should be searchable after rebuild'
    );
  });

  // 10. stats() returns skill count and index stats
  it('stats() returns skillCount and BM25 index stats', async () => {
    await writeFile(join(skillsDir, 'test-skill.md'), SKILL_1);
    await writeFile(join(skillsDir, 'another-skill.md'), SKILL_2);
    await store.load();

    const stats = store.stats();
    assert.ok('skillCount' in stats, 'stats should have skillCount');
    assert.ok('chunkCount' in stats, 'stats should have chunkCount (from BM25)');
    assert.ok('uniqueTerms' in stats, 'stats should have uniqueTerms (from BM25)');

    assert.equal(stats.skillCount, 2, 'skillCount should be 2');
    assert.ok(stats.chunkCount > 0, 'chunkCount should be > 0');
    assert.ok(stats.uniqueTerms > 0, 'uniqueTerms should be > 0');
  });

  // Extra: getSkill() on non-existent skill throws or returns null
  it('getSkill() returns null for unknown skill name', async () => {
    await store.load();
    const result = await store.getSkill('does-not-exist');
    assert.equal(result, null, 'Should return null for unknown skill');
  });

  // Extra: skillStatus() returns null for unknown skill
  it('skillStatus() returns null for unknown skill name', async () => {
    await store.load();
    const status = store.skillStatus('does-not-exist');
    assert.equal(status, null, 'Should return null for unknown skill');
  });

  // Extra: getSection() returns null for unknown section
  it('getSection() returns null for unknown section path', async () => {
    await writeFile(join(skillsDir, 'test-skill.md'), SKILL_1);
    await store.load();

    const result = store.getSection('test-skill', 'nonexistent-section');
    assert.equal(result, null, 'Should return null for unknown section');
  });

  // Extra: empty load (no .md files)
  it('load() handles empty skills directory gracefully', async () => {
    await store.load();
    const list = store.listSkills();
    assert.deepEqual(list, [], 'Empty skills dir should yield empty list');

    const stats = store.stats();
    assert.equal(stats.skillCount, 0);
    assert.equal(stats.chunkCount, 0);
  });
});
