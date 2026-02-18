import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BM25 } from '../src/store/bm25.js';

describe('BM25', () => {
  const sections = [
    { heading: 'BullMQ Patterns', body: 'Use BullMQ for job queues with Redis. Create workers with concurrency settings.', skill: 'automation' },
    { heading: 'Cron Scheduling', body: 'Schedule recurring tasks with cron expressions. Use node-cron or BullMQ repeatable jobs.', skill: 'automation' },
    { heading: 'React Hooks', body: 'useState and useEffect are the most common React hooks. Custom hooks extract reusable logic.', skill: 'frontend' },
    { heading: 'Tailwind Layout', body: 'Use flex and grid utilities for responsive layouts. Tailwind v4 uses CSS-first configuration.', skill: 'frontend' },
    { heading: 'Python Async', body: 'Use asyncio for concurrent IO operations. async/await syntax for coroutines. aiohttp for async HTTP.', skill: 'scripting' },
    { heading: 'Bash Scripting', body: 'Use set -euo pipefail for safety. Trap signals for cleanup. Use shellcheck for linting.', skill: 'scripting' },
  ];

  it('should index sections and return results', () => {
    const bm25 = new BM25();
    bm25.index(sections);
    assert.equal(bm25.documentCount, 6);

    const results = bm25.search('BullMQ job queue');
    assert.ok(results.length > 0);
    assert.equal(results[0].meta.skill, 'automation');
    assert.equal(results[0].meta.heading, 'BullMQ Patterns');
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
    // Python async should be top
    assert.equal(results[0].meta.heading, 'Python Async');
  });
});
