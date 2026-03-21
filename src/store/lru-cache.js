/**
 * LRU Cache with TTL and size-based eviction.
 * Uses a Map for O(1) LRU semantics via insertion-order tracking.
 */
export class LRUCache {
  #map;
  #maxSize;
  #ttlMs;

  constructor({ maxSize, ttlMs }) {
    this.#map = new Map();
    this.#maxSize = maxSize;
    this.#ttlMs = ttlMs;
  }

  get size() {
    return this.#map.size;
  }

  get(key) {
    if (!this.#map.has(key)) return undefined;

    const entry = this.#map.get(key);

    // Check TTL expiration (>= so ttlMs:0 means already expired on get)
    if (Date.now() - entry.timestamp >= this.#ttlMs) {
      this.#map.delete(key);
      return undefined;
    }

    // Promote to most-recently-used by re-inserting at end
    this.#map.delete(key);
    this.#map.set(key, entry);

    return entry.value;
  }

  set(key, value) {
    // Remove existing entry first (so re-insert lands at end)
    if (this.#map.has(key)) {
      this.#map.delete(key);
    }

    // Evict oldest (first) entry if at capacity
    if (this.#map.size >= this.#maxSize) {
      const oldestKey = this.#map.keys().next().value;
      this.#map.delete(oldestKey);
    }

    this.#map.set(key, { value, timestamp: Date.now() });
  }

  clear() {
    this.#map.clear();
  }
}
