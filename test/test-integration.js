import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { SkillStore } from '../src/store/skill-store.js';
import { parseSkill } from '../src/store/parser.js';
import { LRUCache } from '../src/store/cache.js';
import { AuditLog } from '../src/security/audit-log.js';
import { RateLimiter } from '../src/security/rate-limiter.js';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

describe('LRU Cache', () => {
  it('should store and retrieve values', () => {
    const cache = new LRUCache({ maxSize: 3 });
    cache.set('a', 1);
    cache.set('b', 2);
    assert.equal(cache.get('a'), 1);
    assert.equal(cache.get('b'), 2);
  });

  it('should evict oldest entry when full', () => {
    const cache = new LRUCache({ maxSize: 2 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3); // evicts 'a'
    assert.equal(cache.get('a'), undefined);
    assert.equal(cache.get('c'), 3);
  });

  it('should respect TTL', () => {
    const cache = new LRUCache({ ttlMs: 1 });
    cache.set('a', 1);
    // Entry should expire almost immediately
    // Use a small delay
    const start = Date.now();
    while (Date.now() - start < 5) {} // busy-wait 5ms
    assert.equal(cache.get('a'), undefined);
  });
});

describe('Rate Limiter', () => {
  it('should allow requests within limit', () => {
    const rl = new RateLimiter({ maxRequests: 5, windowMs: 1000 });
    for (let i = 0; i < 5; i++) {
      const r = rl.check('conn1');
      assert.ok(r.allowed);
    }
  });

  it('should block requests over limit', () => {
    const rl = new RateLimiter({ maxRequests: 3, windowMs: 1000 });
    rl.check('conn1');
    rl.check('conn1');
    rl.check('conn1');
    const r = rl.check('conn1');
    assert.ok(!r.allowed);
    assert.ok(r.retryAfterMs > 0);
  });

  it('should track connections independently', () => {
    const rl = new RateLimiter({ maxRequests: 1, windowMs: 1000 });
    assert.ok(rl.check('conn1').allowed);
    assert.ok(!rl.check('conn1').allowed);
    assert.ok(rl.check('conn2').allowed); // different connection
  });
});

describe('Audit Log', () => {
  const logPath = join(tmpdir(), `test-audit-${randomBytes(4).toString('hex')}.jsonl`);

  it('should write and verify chain', () => {
    // Clean up
    if (existsSync(logPath)) rmSync(logPath);

    const log = new AuditLog(logPath, 'test-hmac-secret');
    log.log({ event: 'test1', data: 'hello' });
    log.log({ event: 'test2', data: 'world' });
    log.log({ event: 'test3', data: 'chain' });

    const result = log.verify();
    assert.ok(result.valid);
    assert.equal(result.lines, 3);

    // Clean up
    rmSync(logPath);
  });

  it('should redact sensitive fields', () => {
    if (existsSync(logPath)) rmSync(logPath);

    const log = new AuditLog(logPath, 'test-hmac-secret');
    log.log({ event: 'auth', secret: 'supersecret', password: '12345' });

    const line = readFileSync(logPath, 'utf8').trim();
    const entry = JSON.parse(line);
    assert.equal(entry.secret, '[REDACTED]');
    assert.equal(entry.password, '[REDACTED]');

    rmSync(logPath);
  });
});

describe('SkillStore Integration', () => {
  const testDir = join(tmpdir(), `test-skills-${randomBytes(4).toString('hex')}`);

  before(() => {
    // Create test skills
    mkdirSync(join(testDir, 'test-skill'), { recursive: true });
    writeFileSync(join(testDir, 'test-skill', 'SKILL.md'), `---
name: test-skill
description: A test skill for integration tests
---

## Basics

This section covers the basics of testing.

## Advanced

Advanced testing patterns and strategies.
`);
    // Write a manifest (unsigned for simplicity)
    writeFileSync(join(testDir, 'manifest.json'), JSON.stringify({ skills: {} }));
  });

  it('should load skills from directory', () => {
    const store = new SkillStore(testDir);
    const count = store.loadAll();
    assert.equal(count, 1);
  });

  it('should search with BM25', () => {
    const store = new SkillStore(testDir);
    store.loadAll();
    const results = store.search('testing basics');
    assert.ok(results.length > 0);
    assert.equal(results[0].meta.skill, 'test-skill');
  });

  it('should list skills with sections', () => {
    const store = new SkillStore(testDir);
    store.loadAll();
    const list = store.listSkills();
    assert.equal(list.length, 1);
    assert.equal(list[0].name, 'test-skill');
    assert.ok(list[0].sections.includes('Basics'));
    assert.ok(list[0].sections.includes('Advanced'));
  });

  it('should get specific section', () => {
    const store = new SkillStore(testDir);
    store.loadAll();
    const section = store.getSection('test-skill', 'Basics');
    assert.ok(section);
    assert.ok(section.body.includes('basics of testing'));
  });

  it('should return null for missing section', () => {
    const store = new SkillStore(testDir);
    store.loadAll();
    const section = store.getSection('test-skill', 'Nonexistent');
    assert.equal(section, null);
  });
});
