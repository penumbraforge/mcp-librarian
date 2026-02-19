import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BM25, tokenize, stem, chunkSection } from '../src/store/bm25.js';

describe('BM25 — Stemming', () => {
  it('should stem common suffixes', () => {
    assert.equal(stem('configuring'), 'configur');
    assert.equal(stem('configuration'), 'configur');
    assert.equal(stem('configured'), 'configur');
    assert.equal(stem('scheduler'), 'schedul');
    assert.equal(stem('scheduling'), 'schedul');
    assert.equal(stem('handlers'), 'handler');
    assert.equal(stem('management'), 'manag');
    assert.equal(stem('optimization'), 'optim');
  });

  it('should not stem short words', () => {
    assert.equal(stem('go'), 'go');
    assert.equal(stem('css'), 'css');
    assert.equal(stem('api'), 'api');
  });

  it('should tokenize and stem', () => {
    const tokens = tokenize('configuring scheduling handlers');
    assert.ok(tokens.includes('configur'));
    assert.ok(tokens.includes('schedul'));
    assert.ok(tokens.includes('handler'));
  });

  it('should match stemmed queries to stemmed docs', () => {
    const bm25 = new BM25();
    bm25.index([
      { heading: 'Configuration', body: 'Configure the scheduler for optimal performance.', skill: 'test' },
    ]);
    // "configuring" should match "configuration" and "configure" via stemming
    const results = bm25.search('configuring');
    assert.ok(results.length > 0);
  });
});

describe('BM25 — Chunking', () => {
  it('should split sections at ### sub-headings', () => {
    const section = {
      heading: 'BullMQ',
      body: '### Queue Setup\nsetup code\n\n### Worker Patterns\nworker code',
      skill: 'automation',
    };
    const chunks = chunkSection(section);
    assert.ok(chunks.length >= 2);
    assert.equal(chunks[0].heading, 'BullMQ > Queue Setup');
    assert.equal(chunks[1].heading, 'BullMQ > Worker Patterns');
    assert.ok(chunks[0].body.includes('setup code'));
    assert.ok(chunks[1].body.includes('worker code'));
  });

  it('should preserve parentHeading for navigation', () => {
    const section = {
      heading: 'Docker',
      body: '### Dockerfile\nmulti-stage\n\n### Compose\nservices:',
      skill: 'automation',
    };
    const chunks = chunkSection(section);
    for (const c of chunks) {
      assert.equal(c.parentHeading, 'Docker');
    }
  });

  it('should not chunk small sections without sub-headings', () => {
    const section = {
      heading: 'Small Section',
      body: 'Just a short paragraph.',
      skill: 'test',
    };
    const chunks = chunkSection(section);
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0], section); // Same object
  });
});

describe('BM25 — Search', () => {
  const sections = [
    { heading: 'BullMQ', body: '### Queue Setup\nUse BullMQ for job queues with Redis.\n\n### Worker Patterns\nCreate workers with concurrency settings.', skill: 'automation' },
    { heading: 'Cron Scheduling', body: 'Schedule recurring tasks with cron expressions. Use node-cron or BullMQ repeatable jobs.', skill: 'automation' },
    { heading: 'React Hooks', body: 'useState and useEffect are the most common React hooks. Custom hooks extract reusable logic.', skill: 'frontend' },
    { heading: 'Tailwind Layout', body: 'Use flex and grid utilities for responsive layouts. Tailwind v4 uses CSS-first configuration.', skill: 'frontend' },
    { heading: 'Python Async', body: 'Use asyncio for concurrent IO operations. async/await syntax for coroutines. aiohttp for async HTTP.', skill: 'scripting' },
    { heading: 'Bash Scripting', body: 'Use set -euo pipefail for safety. Trap signals for cleanup. Use shellcheck for linting.', skill: 'scripting' },
  ];

  it('should index sections and return results', () => {
    const bm25 = new BM25();
    bm25.index(sections);
    assert.ok(bm25.documentCount > 0);

    const results = bm25.search('BullMQ job queue');
    assert.ok(results.length > 0);
    assert.equal(results[0].meta.skill, 'automation');
  });

  it('should rank relevant results higher', () => {
    const bm25 = new BM25();
    bm25.index(sections);

    const results = bm25.search('React hooks custom');
    assert.ok(results.length > 0);
    assert.equal(results[0].meta.heading, 'React Hooks');
  });

  it('should handle empty query', () => {
    const bm25 = new BM25();
    bm25.index(sections);
    const results = bm25.search('');
    assert.equal(results.length, 0);
  });

  it('should handle no matches', () => {
    const bm25 = new BM25();
    bm25.index(sections);
    const results = bm25.search('xyzzynotaword');
    assert.equal(results.length, 0);
  });

  it('should respect topK', () => {
    const bm25 = new BM25();
    bm25.index(sections);
    const results = bm25.search('use', 2);
    assert.ok(results.length <= 2);
  });

  it('should return cross-skill results', () => {
    const bm25 = new BM25();
    bm25.index(sections);
    const results = bm25.search('async concurrent');
    assert.ok(results.length > 0);
    assert.equal(results[0].meta.heading, 'Python Async');
  });

  it('should match stemmed variants', () => {
    const bm25 = new BM25();
    bm25.index(sections);
    // "scheduling" should match "Schedule" via stemming
    const results = bm25.search('scheduling');
    assert.ok(results.length > 0);
    const hasScheduling = results.some(r => r.meta.heading === 'Cron Scheduling' || r.meta.heading.includes('Cron'));
    assert.ok(hasScheduling, 'Should find Cron Scheduling section');
  });
});
