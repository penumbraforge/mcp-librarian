import { appendFileSync, readFileSync, existsSync } from 'node:fs';
import { createHmac } from 'node:crypto';

const REDACT_KEYS = new Set(['secret', 'password', 'token', 'key', 'privateKey']);

export class AuditLog {
  constructor(logPath, hmacSecret) {
    if (!hmacSecret || typeof hmacSecret !== 'string' || hmacSecret.length < 32) {
      throw new Error('Audit log requires a valid HMAC secret (min 32 chars)');
    }
    this.logPath = logPath;
    this.hmacSecret = hmacSecret;
    this.lastHash = this._loadLastHash();
    this.lineCount = this._countLines();
  }

  _countLines() {
    if (!existsSync(this.logPath)) return 0;
    try {
      const data = readFileSync(this.logPath, 'utf8').trim();
      if (!data) return 0;
      return data.split('\n').length;
    } catch {
      return 0;
    }
  }

  _loadLastHash() {
    if (!existsSync(this.logPath)) return '0'.repeat(64);
    try {
      const data = readFileSync(this.logPath, 'utf8').trim();
      if (!data) return '0'.repeat(64);
      const lines = data.split('\n');
      const last = JSON.parse(lines[lines.length - 1]);
      return last._hash || '0'.repeat(64);
    } catch {
      return '0'.repeat(64);
    }
  }

  _computeHash(entry) {
    const payload = JSON.stringify(entry);
    return createHmac('sha256', this.hmacSecret)
      .update(this.lastHash + payload)
      .digest('hex');
  }

  _redact(obj, seen = new WeakSet()) {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj !== 'object') return obj;
    if (seen.has(obj)) return '[CIRCULAR]';
    seen.add(obj);
    if (Array.isArray(obj)) return obj.map(v => this._redact(v, seen));
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (REDACT_KEYS.has(k.toLowerCase())) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = this._redact(v, seen);
      }
    }
    return out;
  }

  log(event) {
    // Detect truncation: if line count on disk is less than expected, log was tampered
    const currentLines = this._countLines();
    if (currentLines < this.lineCount) {
      // Log truncation detected — reset chain with a tamper event
      const tamperEntry = {
        ts: new Date().toISOString(),
        event: 'AUDIT_TRUNCATION_DETECTED',
        expectedLines: this.lineCount,
        actualLines: currentLines,
        _prev: this.lastHash,
      };
      tamperEntry._hash = this._computeHash(tamperEntry);
      this.lastHash = tamperEntry._hash;
      this.lineCount = currentLines + 1;
      appendFileSync(this.logPath, JSON.stringify(tamperEntry) + '\n', { mode: 0o600 });
    }

    const entry = {
      ts: new Date().toISOString(),
      _seq: this.lineCount,
      ...this._redact(event),
      _prev: this.lastHash,
    };
    entry._hash = this._computeHash(entry);
    this.lastHash = entry._hash;
    this.lineCount++;

    appendFileSync(this.logPath, JSON.stringify(entry) + '\n', { mode: 0o600 });
  }

  verify() {
    if (!existsSync(this.logPath)) return { valid: true, lines: 0 };
    const data = readFileSync(this.logPath, 'utf8').trim();
    if (!data) return { valid: true, lines: 0 };

    const lines = data.split('\n');
    let prevHash = '0'.repeat(64);

    for (let i = 0; i < lines.length; i++) {
      let entry;
      try {
        entry = JSON.parse(lines[i]);
      } catch {
        return { valid: false, line: i + 1, reason: 'malformed JSON' };
      }
      if (entry._prev !== prevHash) {
        return { valid: false, line: i + 1, reason: 'chain break' };
      }
      const storedHash = entry._hash;
      const check = { ...entry };
      delete check._hash;
      const expected = createHmac('sha256', this.hmacSecret)
        .update(prevHash + JSON.stringify(check))
        .digest('hex');
      if (storedHash !== expected) {
        return { valid: false, line: i + 1, reason: 'hash mismatch' };
      }
      prevHash = storedHash;
    }
    return { valid: true, lines: lines.length };
  }
}
