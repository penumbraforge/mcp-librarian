const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_REQUESTS = 100;

export class RateLimiter {
  constructor(opts = {}) {
    this.windowMs = opts.windowMs ?? DEFAULT_WINDOW_MS;
    this.maxRequests = opts.maxRequests ?? DEFAULT_MAX_REQUESTS;
    this.windows = new Map(); // connectionId → { timestamps: number[], head: number }
  }

  check(connectionId) {
    const now = Date.now();
    const cutoff = now - this.windowMs;

    let bucket = this.windows.get(connectionId);
    if (!bucket) {
      bucket = { timestamps: [], count: 0 };
      this.windows.set(connectionId, bucket);
    }

    // Compact expired entries: instead of shift (O(n)), track from start
    while (bucket.count > 0 && bucket.timestamps[bucket.timestamps.length - bucket.count] <= cutoff) {
      bucket.count--;
    }

    // Periodic compaction to prevent unbounded array growth
    if (bucket.timestamps.length > this.maxRequests * 4 && bucket.timestamps.length - bucket.count > this.maxRequests * 2) {
      bucket.timestamps = bucket.timestamps.slice(bucket.timestamps.length - bucket.count);
    }

    if (bucket.count >= this.maxRequests) {
      const oldest = bucket.timestamps[bucket.timestamps.length - bucket.count];
      return { allowed: false, remaining: 0, retryAfterMs: oldest + this.windowMs - now };
    }

    bucket.timestamps.push(now);
    bucket.count++;
    return { allowed: true, remaining: this.maxRequests - bucket.count };
  }

  remove(connectionId) {
    this.windows.delete(connectionId);
  }

  reset() {
    this.windows.clear();
  }
}
