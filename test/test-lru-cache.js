import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LRUCache } from '../src/store/lru-cache.js';

describe('LRUCache', () => {
  it('get() on missing key returns undefined', () => {
    const cache = new LRUCache({ maxSize: 3, ttlMs: 60_000 });
    assert.equal(cache.get('missing'), undefined);
  });

  it('set() then get() returns the stored value', () => {
    const cache = new LRUCache({ maxSize: 3, ttlMs: 60_000 });
    cache.set('a', 42);
    assert.equal(cache.get('a'), 42);
  });

  it('stores complex values correctly', () => {
    const cache = new LRUCache({ maxSize: 3, ttlMs: 60_000 });
    const obj = { foo: 'bar', nested: { x: 1 } };
    cache.set('obj', obj);
    assert.deepEqual(cache.get('obj'), obj);
  });

  it('evicts LRU (oldest) entry when at capacity', () => {
    const cache = new LRUCache({ maxSize: 3, ttlMs: 60_000 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    cache.set('d', 4); // 'a' should be evicted
    assert.equal(cache.get('a'), undefined);
    assert.equal(cache.get('b'), 2);
    assert.equal(cache.get('c'), 3);
    assert.equal(cache.get('d'), 4);
  });

  it('get() promotes entry — recently accessed is not evicted', () => {
    const cache = new LRUCache({ maxSize: 3, ttlMs: 60_000 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    cache.get('a'); // promote 'a', so 'b' becomes LRU
    cache.set('d', 4); // 'b' should be evicted now
    assert.equal(cache.get('a'), 1);
    assert.equal(cache.get('b'), undefined);
    assert.equal(cache.get('c'), 3);
    assert.equal(cache.get('d'), 4);
  });

  it('TTL — expired entry returns undefined and is removed', () => {
    const cache = new LRUCache({ maxSize: 3, ttlMs: 0 });
    cache.set('x', 'hello');
    // With ttlMs=0, any positive elapsed time means expired
    assert.equal(cache.get('x'), undefined);
    assert.equal(cache.size, 0);
  });

  it('TTL — non-expired entry is returned', () => {
    const cache = new LRUCache({ maxSize: 3, ttlMs: 60_000 });
    cache.set('y', 'world');
    assert.equal(cache.get('y'), 'world');
  });

  it('clear() empties the cache', () => {
    const cache = new LRUCache({ maxSize: 5, ttlMs: 60_000 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    cache.clear();
    assert.equal(cache.size, 0);
    assert.equal(cache.get('a'), undefined);
    assert.equal(cache.get('b'), undefined);
  });

  it('size getter returns current count', () => {
    const cache = new LRUCache({ maxSize: 5, ttlMs: 60_000 });
    assert.equal(cache.size, 0);
    cache.set('a', 1);
    assert.equal(cache.size, 1);
    cache.set('b', 2);
    assert.equal(cache.size, 2);
    cache.set('a', 99); // overwrite — should not increase size
    assert.equal(cache.size, 2);
  });

  it('set() on existing key updates value without growing size beyond maxSize', () => {
    const cache = new LRUCache({ maxSize: 2, ttlMs: 60_000 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('a', 100); // update existing key
    assert.equal(cache.size, 2);
    assert.equal(cache.get('a'), 100);
    assert.equal(cache.get('b'), 2);
  });

  it('evicts correctly after multiple promotions', () => {
    const cache = new LRUCache({ maxSize: 3, ttlMs: 60_000 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    cache.get('a'); // order: b, c, a
    cache.get('b'); // order: c, a, b
    cache.set('d', 4); // evict 'c'
    assert.equal(cache.get('c'), undefined);
    assert.equal(cache.get('a'), 1);
    assert.equal(cache.get('b'), 2);
    assert.equal(cache.get('d'), 4);
  });
});
