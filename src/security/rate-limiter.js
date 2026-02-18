const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_REQUESTS = 100;

export class RateLimiter {
  constructor(opts = {}) {
    this.windowMs = opts.windowMs ?? DEFAULT_WINDOW_MS;
    this.maxRequests = opts.maxRequests ?? DEFAULT_MAX_REQUESTS;
    this.windows = new Map(); // connectionId → timestamp[]
  }

  check(connectionId) {
    const now = Date.now();
    const cutoff = now - this.windowMs;

    let timestamps = this.windows.get(connectionId);
    if (!timestamps) {
      timestamps = [];
      this.windows.set(connectionId, timestamps);
    }

    // Remove expired entries
    while (timestamps.length > 0 && timestamps[0] <= cutoff) {
      timestamps.shift();
    }

    if (timestamps.length >= this.maxRequests) {
      return { allowed: false, remaining: 0, retryAfterMs: timestamps[0] + this.windowMs - now };
    }

    timestamps.push(now);
    return { allowed: true, remaining: this.maxRequests - timestamps.length };
  }

  remove(connectionId) {
    this.windows.delete(connectionId);
  }

  reset() {
    this.windows.clear();
  }
}
