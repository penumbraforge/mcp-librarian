import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BM25Index, parseSkillSections } from '../src/store/bm25.js';

describe('parseSkillSections', () => {
  it('## with no ### children → one chunk', () => {
    const content = `# Skill Name

## Overview
This is the overview section with some content.

## Usage
Here is how to use it.
`;
    const chunks = parseSkillSections(content);
    assert.equal(chunks.length, 2);
    assert.equal(chunks[0].section, 'overview');
    assert.ok(chunks[0].content.includes('overview'));
    assert.equal(chunks[1].section, 'usage');
    assert.ok(chunks[1].content.includes('use it'));
  });

  it('## with ### children → splits into sub-chunks', () => {
    const content = `# Skill Name

## Configuration
Some intro text.

### Basic Config
Basic configuration details here.

### Advanced Config
Advanced configuration details here.
`;
    const chunks = parseSkillSections(content);
    // Should have: intro chunk + 2 sub-section chunks = 3
    assert.equal(chunks.length, 3);
    const sections = chunks.map(c => c.section);
    assert.ok(sections.includes('configuration'));
    assert.ok(sections.includes('configuration/basic-config'));
    assert.ok(sections.includes('configuration/advanced-config'));
  });

  it('## with ### children but no intro text → no intro chunk', () => {
    const content = `# Skill Name

## Configuration

### Basic Config
Basic configuration details here.

### Advanced Config
Advanced configuration details here.
`;
    const chunks = parseSkillSections(content);
    // No non-empty intro text, so 2 sub-section chunks only
    assert.equal(chunks.length, 2);
    const sections = chunks.map(c => c.section);
    assert.ok(sections.includes('configuration/basic-config'));
    assert.ok(sections.includes('configuration/advanced-config'));
  });

  it('section slugs are lowercase with hyphens for spaces', () => {
    const content = `# Skill Name

## My Cool Section
Some content here.

## Another Great Section
More content.
`;
    const chunks = parseSkillSections(content);
    assert.equal(chunks[0].section, 'my-cool-section');
    assert.equal(chunks[1].section, 'another-great-section');
  });

  it('sub-section slug is parent/child path', () => {
    const content = `# Skill Name

## Getting Started

### Quick Start Guide
Get up and running fast.
`;
    const chunks = parseSkillSections(content);
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].section, 'getting-started/quick-start-guide');
  });

  it('chunks include their heading text', () => {
    const content = `# Skill Name

## Overview
This is the overview.
`;
    const chunks = parseSkillSections(content);
    assert.equal(chunks.length, 1);
    assert.ok(chunks[0].content.includes('Overview'));
  });

  it('returns empty array for content with no ## sections', () => {
    const content = `# Skill Name

Just some top-level content without sections.
`;
    const chunks = parseSkillSections(content);
    assert.equal(chunks.length, 0);
  });
});

describe('BM25Index', () => {
  it('add() + search() returns relevant results', () => {
    const idx = new BM25Index();
    idx.add('my-skill', 'overview', 'This skill helps you manage your files and documents efficiently.');
    idx.add('my-skill', 'usage', 'Use the search function to find files quickly.');
    const results = idx.search('files');
    assert.ok(results.length > 0);
    assert.ok(results[0].score > 0);
    assert.equal(results[0].skill, 'my-skill');
  });

  it('search ranking — document with more term matches scores higher', () => {
    const idx = new BM25Index();
    idx.add('skill-a', 'overview', 'cats cats cats love to play with cats all day');
    idx.add('skill-b', 'overview', 'cats are nice animals');
    const results = idx.search('cats');
    assert.ok(results.length >= 2);
    assert.equal(results[0].skill, 'skill-a'); // higher TF should win
  });

  it('stemming — searching "configuring" matches content with "configuration"', () => {
    const idx = new BM25Index();
    idx.add('skill-a', 'setup', 'Here is the configuration for the server settings.');
    idx.add('skill-b', 'other', 'Something completely unrelated about weather.');
    const results = idx.search('configuring');
    assert.ok(results.length > 0);
    assert.equal(results[0].skill, 'skill-a');
  });

  it('empty query returns empty results', () => {
    const idx = new BM25Index();
    idx.add('skill-a', 'overview', 'Some content here.');
    const results = idx.search('');
    assert.deepEqual(results, []);
  });

  it('query of only stopwords returns empty results', () => {
    const idx = new BM25Index();
    idx.add('skill-a', 'overview', 'Some content here.');
    const results = idx.search('the and or but');
    assert.deepEqual(results, []);
  });

  it('unicode input does not crash', () => {
    const idx = new BM25Index();
    assert.doesNotThrow(() => {
      idx.add('skill-unicode', 'overview', 'Héllo wörld with ünïcode chäracters 日本語 中文');
      idx.search('hello world unicode');
    });
  });

  it('search returns result with snippet truncated to ~200 chars', () => {
    const idx = new BM25Index();
    const longContent = 'target word ' + 'a'.repeat(300);
    idx.add('skill-a', 'section', longContent);
    const results = idx.search('target');
    assert.ok(results.length > 0);
    assert.ok(results[0].snippet.length <= 210); // ~200, allow small buffer
  });

  it('search result includes skill, section, score, snippet fields', () => {
    const idx = new BM25Index();
    idx.add('my-skill', 'my-section', 'The quick brown fox jumps over the lazy dog.');
    const results = idx.search('fox');
    assert.ok(results.length > 0);
    const r = results[0];
    assert.equal(typeof r.skill, 'string');
    assert.equal(typeof r.section, 'string');
    assert.equal(typeof r.score, 'number');
    assert.equal(typeof r.snippet, 'string');
    assert.equal(r.skill, 'my-skill');
    assert.equal(r.section, 'my-section');
  });

  it('clear() resets the index', () => {
    const idx = new BM25Index();
    idx.add('skill-a', 'overview', 'Interesting content about cats.');
    idx.clear();
    const results = idx.search('cats');
    assert.deepEqual(results, []);
  });

  it('stats() returns correct chunkCount and uniqueTerms', () => {
    const idx = new BM25Index();
    idx.add('skill-a', 'section1', 'hello world');
    idx.add('skill-a', 'section2', 'world foo bar');
    const s = idx.stats();
    assert.equal(typeof s.chunkCount, 'number');
    assert.equal(typeof s.uniqueTerms, 'number');
    assert.equal(s.chunkCount, 2);
    assert.ok(s.uniqueTerms >= 4); // hello, world, foo, bar (world shared)
  });

  it('search respects limit parameter', () => {
    const idx = new BM25Index();
    for (let i = 0; i < 20; i++) {
      idx.add(`skill-${i}`, 'overview', `content about dogs and cats and animals ${i}`);
    }
    const results = idx.search('dogs', 5);
    assert.ok(results.length <= 5);
  });

  it('multiple skills — only matching ones returned', () => {
    const idx = new BM25Index();
    idx.add('skill-cats', 'overview', 'This is all about cats and feline creatures.');
    idx.add('skill-dogs', 'overview', 'This is about dogs and canine companions.');
    idx.add('skill-birds', 'overview', 'Birds fly and tweet and sing.');
    const results = idx.search('cats feline');
    assert.ok(results.length >= 1);
    assert.equal(results[0].skill, 'skill-cats');
  });
});
