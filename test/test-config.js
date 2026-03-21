import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config/config.js';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('config', () => {
  const testDir = join(tmpdir(), `mcp-librarian-test-${Date.now()}`);

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
    delete process.env.MCP_LIBRARIAN_HOME;
    delete process.env.MCP_LIBRARIAN_LOG_LEVEL;
    delete process.env.MCP_LIBRARIAN_RATE_LIMIT;
    delete process.env.MCP_LIBRARIAN_CACHE_SIZE;
    delete process.env.MCP_LIBRARIAN_CACHE_TTL;
    delete process.env.MCP_LIBRARIAN_SKILLS_REPO;
  });

  it('returns defaults when no config file and no env vars', async () => {
    const config = await loadConfig(testDir);
    assert.equal(config.logLevel, 'info');
    assert.equal(config.rateLimit, 200);
    assert.equal(config.cacheSize, 100);
    assert.equal(config.cacheTtl, 600000);
    assert.equal(config.skillsRepo, 'penumbraforge/mcp-librarian-skills');
    assert.equal(config.home, testDir);
  });

  it('loads config from file', async () => {
    await writeFile(join(testDir, 'config.json'), JSON.stringify({ logLevel: 'debug', rateLimit: 50 }));
    const config = await loadConfig(testDir);
    assert.equal(config.logLevel, 'debug');
    assert.equal(config.rateLimit, 50);
    assert.equal(config.cacheSize, 100);
  });

  it('env vars override file values', async () => {
    await writeFile(join(testDir, 'config.json'), JSON.stringify({ logLevel: 'debug' }));
    process.env.MCP_LIBRARIAN_LOG_LEVEL = 'error';
    const config = await loadConfig(testDir);
    assert.equal(config.logLevel, 'error');
  });

  it('rejects invalid log level and falls back to default', async () => {
    process.env.MCP_LIBRARIAN_LOG_LEVEL = 'verbose';
    const config = await loadConfig(testDir);
    assert.equal(config.logLevel, 'info');
    assert.ok(config._warnings.length > 0);
  });

  it('rejects non-numeric rate limit', async () => {
    process.env.MCP_LIBRARIAN_RATE_LIMIT = 'abc';
    const config = await loadConfig(testDir);
    assert.equal(config.rateLimit, 200);
  });
});
