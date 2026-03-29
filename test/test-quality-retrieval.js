import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BM25 } from '../src/store/bm25.js';

describe('quality-weighted retrieval', () => {
  it('ranks high-quality results above low-quality for same relevance', () => {
    const bm25 = new BM25();
    bm25.index([
      { heading: 'SQL injection', body: 'Use sqlmap for testing injection', skill: 'low-quality', quality: 0.3 },
      { heading: 'SQL injection', body: 'Use sqlmap for testing injection', skill: 'high-quality', quality: 0.9 },
    ]);
    const results = bm25.search('SQL injection', 2);
    assert.equal(results.length, 2);
    assert.equal(results[0].meta.skill, 'high-quality');
    assert.equal(results[1].meta.skill, 'low-quality');
  });

  it('returns empty for zero BM25 matches', () => {
    const bm25 = new BM25();
    bm25.index([
      { heading: 'React hooks', body: 'useState and useEffect', skill: 'frontend', quality: 0.8 },
    ]);
    const results = bm25.search('totally unrelated query xyz', 5);
    assert.equal(results.length, 0);
  });

  it('still respects BM25 relevance over quality when relevance differs significantly', () => {
    const bm25 = new BM25();
    bm25.index([
      { heading: 'Docker compose', body: 'docker compose up -d for running containers with docker', skill: 'docker', quality: 0.3 },
      { heading: 'React hooks', body: 'useState and useEffect for state', skill: 'react', quality: 0.9 },
    ]);
    const results = bm25.search('docker compose containers', 2);
    assert.equal(results[0].meta.skill, 'docker');
  });

  it('uses default quality 0.5 when not provided', () => {
    const bm25 = new BM25();
    bm25.index([
      { heading: 'Test', body: 'some content here', skill: 'no-quality' },
    ]);
    const results = bm25.search('content', 1);
    assert.equal(results.length, 1);
  });
});
