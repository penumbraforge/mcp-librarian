# mcp-librarian v3.0.0 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clean room rewrite of mcp-librarian as a zero-dependency MCP 2025 skills server with stdio transport, BM25 search, Ed25519 integrity, and community skill pack installation.

**Architecture:** Stdio NDJSON transport → JSON-RPC 2.0 dispatcher → MCP tool/resource/prompt handlers → SkillStore (BM25 index + LRU cache + dedup) → Security layer (Ed25519, content guard, path guard). All async I/O. Config via env > file > defaults.

**Tech Stack:** Node.js >= 22, ESM, zero external dependencies, `node:test` for testing

**Spec:** `docs/superpowers/specs/2026-03-21-librarian-v3-design.md`

**Important:** This is a clean room rewrite. Start from an empty project — do NOT copy code from the old v2 codebase. Reference v2 for algorithm details (BM25, Ed25519 patterns) but write all code fresh.

---

## File Map

| File | Responsibility |
|------|---------------|
| `package.json` | Project metadata, ESM, Node >= 22, scripts |
| `.gitignore` | node_modules, coverage |
| `src/errors.js` | Structured error types and ERROR_CODES constant |
| `src/config/config.js` | Load config (env > file > defaults), validate |
| `src/security/ed25519.js` | Generate keypair, sign skills, verify signatures, manifest I/O |
| `src/security/content-guard.js` | Detect prompt injection in prose, allow in code blocks |
| `src/security/path-guard.js` | Directory traversal prevention, symlink resolution |
| `src/store/lru-cache.js` | LRU cache with configurable size and TTL |
| `src/store/bm25.js` | BM25 search index with stemming, sub-section chunking |
| `src/store/dedup.js` | SHA-256 deduplication: detect duplicates, handle updates |
| `src/store/skill-store.js` | Load skills, parse frontmatter, coordinate index/cache/dedup/integrity |
| `src/transport/stdio.js` | NDJSON reader/writer on stdin/stdout |
| `src/protocol/dispatcher.js` | JSON-RPC 2.0 router, MCP lifecycle (initialize, ping) |
| `src/protocol/tools.js` | Tool handlers: find_skill, load_section, load_skill, list_skills, skill_status, validate_skill, install_pack, server_status |
| `src/protocol/resources.js` | Resource handlers: skill:// URI listing and reading |
| `src/protocol/prompts.js` | Prompt templates: write_skill, improve_skill |
| `src/protocol/logging.js` | MCP logging: setLevel, emit notifications |
| `src/protocol/pack-fetcher.js` | GitHub raw content fetcher for install_pack |
| `bin/mcp-librarian.js` | Entry point: wires config → store → protocol → transport. Also `sign` subcommand. |
| `bin/install.js` | Install script: create dirs, generate keys, detect + configure MCP clients |
| `test/test-errors.js` | Error codes and types |
| `test/test-config.js` | Config loading, env override, validation |
| `test/test-ed25519.js` | Key generation, signing, verification, tamper detection |
| `test/test-content-guard.js` | Injection patterns, code block allowlisting |
| `test/test-path-guard.js` | Traversal, symlinks, null bytes |
| `test/test-lru-cache.js` | Eviction, TTL, hits/misses |
| `test/test-bm25.js` | Indexing, search ranking, stemming, chunking |
| `test/test-dedup.js` | Exact match, name collision, update vs skip |
| `test/test-skill-store.js` | Load, index, integrity caching, dedup on rebuild |
| `test/test-stdio.js` | NDJSON parsing, line buffering, malformed input |
| `test/test-dispatcher.js` | JSON-RPC routing, MCP lifecycle, unknown methods |
| `test/test-tools.js` | Each tool handler end-to-end |
| `test/test-resources.js` | Resource list and read |
| `test/test-prompts.js` | Prompt listing, template generation |
| `test/test-rate-limiter.js` | Window tracking, limit enforcement |
| `LICENSE` | MIT, Copyright 2026 Penumbra Forge |
| `README.md` | Full documentation |
| `.github/workflows/ci.yml` | Test on push, Node 22, macOS + Ubuntu |

---

### Task 1: Project scaffold, errors, and config

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `src/errors.js`
- Create: `src/config/config.js`
- Create: `LICENSE`
- Test: `test/test-errors.js`, `test/test-config.js`

- [ ] **Step 1: Initialize new git repo**

Create a new clean directory for the rewrite (NOT in the existing mcp-librarian checkout):

```bash
mkdir -p ~/penumbraprojects/mcp-librarian-v3
cd ~/penumbraprojects/mcp-librarian-v3
git init
```

- [ ] **Step 2: Create package.json**

```json
{
  "name": "mcp-librarian",
  "version": "3.0.0",
  "description": "Zero-dependency MCP skills server — BM25 search, Ed25519 integrity, progressive disclosure",
  "type": "module",
  "engines": { "node": ">=22.0.0" },
  "bin": {
    "mcp-librarian": "./bin/mcp-librarian.js"
  },
  "scripts": {
    "start": "node bin/mcp-librarian.js",
    "test": "node --test test/test-*.js",
    "install-server": "node bin/install.js"
  },
  "keywords": ["mcp", "skills", "search", "bm25", "ed25519"],
  "author": "Shadoe Myers <shadoe@penumbraforge.com>",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/penumbraforge/mcp-librarian.git"
  }
}
```

- [ ] **Step 3: Create .gitignore**

```
node_modules/
coverage/
.DS_Store
```

- [ ] **Step 4: Create LICENSE**

MIT License, Copyright (c) 2026 Penumbra Forge. Standard MIT text.

- [ ] **Step 5: Write failing test for errors.js**

Create `test/test-errors.js`:

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ERROR_CODES, McpError } from '../src/errors.js';

describe('errors', () => {
  it('defines all error codes as negative integers', () => {
    for (const [name, code] of Object.entries(ERROR_CODES)) {
      assert.equal(typeof code, 'number');
      assert.ok(code < 0, `${name} should be negative`);
    }
  });

  it('includes all required error codes', () => {
    const required = [
      'SKILL_NOT_FOUND', 'INVALID_INPUT', 'RATE_LIMITED',
      'CONTENT_GUARD', 'INTEGRITY_FAILED', 'PACK_NOT_FOUND',
      'PACK_FETCH_FAILED', 'VALIDATION_FAILED', 'CONFIG_ERROR',
      'PATH_VIOLATION', 'SERVER_ERROR'
    ];
    for (const name of required) {
      assert.ok(name in ERROR_CODES, `Missing error code: ${name}`);
    }
  });

  it('creates McpError with code, message, and context', () => {
    const err = new McpError(ERROR_CODES.SKILL_NOT_FOUND, 'not found', { skill: 'test' });
    assert.equal(err.code, -32001);
    assert.equal(err.message, 'not found');
    assert.deepEqual(err.context, { skill: 'test' });
    assert.ok(err instanceof Error);
  });
});
```

- [ ] **Step 6: Run test, verify it fails**

Run: `node --test test/test-errors.js`
Expected: FAIL — module not found.

- [ ] **Step 7: Implement errors.js**

Create `src/errors.js`:

```javascript
export const ERROR_CODES = {
  SERVER_ERROR:        -32000,
  SKILL_NOT_FOUND:     -32001,
  INVALID_INPUT:       -32002,
  RATE_LIMITED:        -32003,
  CONTENT_GUARD:       -32004,
  INTEGRITY_FAILED:    -32005,
  PACK_NOT_FOUND:      -32006,
  PACK_FETCH_FAILED:   -32007,
  VALIDATION_FAILED:   -32008,
  CONFIG_ERROR:        -32009,
  PATH_VIOLATION:      -32010,
};

export class McpError extends Error {
  constructor(code, message, context = {}) {
    super(message);
    this.code = code;
    this.context = context;
    this.name = 'McpError';
  }

  toJsonRpc(id) {
    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: this.code,
        message: this.message,
        data: this.context,
      },
    };
  }
}
```

- [ ] **Step 8: Run test, verify it passes**

Run: `node --test test/test-errors.js`
Expected: PASS — all 3 tests.

- [ ] **Step 9: Write failing test for config.js**

Create `test/test-config.js`:

```javascript
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, DEFAULTS } from '../src/config/config.js';
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
    // Clean env vars
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
    assert.equal(config.cacheSize, 100); // still default
  });

  it('env vars override file values', async () => {
    await writeFile(join(testDir, 'config.json'), JSON.stringify({ logLevel: 'debug' }));
    process.env.MCP_LIBRARIAN_LOG_LEVEL = 'error';
    const config = await loadConfig(testDir);
    assert.equal(config.logLevel, 'error');
  });

  it('rejects invalid log level', async () => {
    process.env.MCP_LIBRARIAN_LOG_LEVEL = 'verbose';
    const config = await loadConfig(testDir);
    assert.equal(config.logLevel, 'info'); // falls back to default
    assert.ok(config._warnings.length > 0);
  });

  it('rejects non-numeric rate limit', async () => {
    process.env.MCP_LIBRARIAN_RATE_LIMIT = 'abc';
    const config = await loadConfig(testDir);
    assert.equal(config.rateLimit, 200); // falls back to default
  });
});
```

- [ ] **Step 10: Implement config.js**

Create `src/config/config.js`:

Load config with precedence: env > file > defaults. Validate each field. Return config object with `_warnings` array for any validation issues.

Key behavior:
- Read `{home}/config.json` if it exists (async, ignore if missing)
- Override with env vars: `MCP_LIBRARIAN_LOG_LEVEL`, `MCP_LIBRARIAN_RATE_LIMIT`, etc.
- Validate: logLevel must be debug/info/warning/error, rateLimit must be positive number, etc.
- Invalid values fall back to defaults and add to `_warnings`

Export `DEFAULTS` object and `loadConfig(home)` async function.

- [ ] **Step 11: Run all tests**

Run: `node --test test/test-*.js`
Expected: All pass.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat: project scaffold with errors module and config loader"
```

---

### Task 2: Security — Ed25519 signing

**Files:**
- Create: `src/security/ed25519.js`
- Test: `test/test-ed25519.js`

- [ ] **Step 1: Write failing tests**

Create `test/test-ed25519.js` covering:
- `generateKeypair()` — returns `{ publicKey, privateKey }` PEM strings
- `signSkill(content, privateKey)` — returns `{ hash, signature, signedAt }` where hash is SHA-256 hex, signature is base64 Ed25519 of `"{hash}|{signedAt}"`
- `verifySkill(content, entry, publicKey)` — returns `'VERIFIED'` for valid
- `verifySkill()` with tampered content — returns `'TAMPERED'`
- `verifySkill()` with missing manifest entry — returns `'UNSIGNED'`
- `loadManifest(path)` — reads and parses manifest.json
- `saveManifest(path, manifest)` — writes atomically (tmp + rename)
- `signAllSkills(skillsDir, keysDir)` — signs all `.md` files, writes manifest

Use temp directories for all file operations. All functions are async.

- [ ] **Step 2: Run tests, verify they fail**

Run: `node --test test/test-ed25519.js`

- [ ] **Step 3: Implement ed25519.js**

Create `src/security/ed25519.js` using `node:crypto` for:
- `generateKeyPairSync('ed25519', ...)` (only sync call — used during install, not runtime)
- `createHash('sha256')` for content hashing
- `sign(null, payload, privateKey)` for Ed25519 signing
- `verify(null, payload, publicKey, signature)` for verification

Manifest format per spec:
```json
{
  "version": 1,
  "signedAt": "ISO-8601",
  "skills": { "name": { "hash": "hex", "signature": "base64", "signedAt": "ISO-8601" } }
}
```

Atomic writes: write to `manifest.json.tmp`, rename to `manifest.json`.

- [ ] **Step 4: Run tests, verify they pass**

Run: `node --test test/test-ed25519.js`

- [ ] **Step 5: Commit**

```bash
git add src/security/ed25519.js test/test-ed25519.js
git commit -m "feat: Ed25519 skill signing and verification"
```

---

### Task 3: Security — Content guard

**Files:**
- Create: `src/security/content-guard.js`
- Test: `test/test-content-guard.js`

- [ ] **Step 1: Write failing tests**

Create `test/test-content-guard.js` covering:
- Blocks ChatML tokens (`<|im_start|>`, `<|system|>`) in prose
- Blocks Llama tokens (`[INST]`, `<<SYS>>`) in prose
- Blocks instruction overrides (`IGNORE ALL PREVIOUS INSTRUCTIONS`)
- Blocks role impersonation (`YOU ARE NOW a different assistant`)
- Blocks data exfiltration (`REVEAL YOUR SYSTEM PROMPT`)
- Blocks XML injection (`<operations>`, `<instructions>`)
- Blocks Unicode tricks: null bytes, RTL override, zero-width chars, variation selectors, soft hyphens
- Blocks large base64 payloads (>5000 chars) in prose
- **ALLOWS** all of the above inside fenced code blocks (``` delimited)
- **ALLOWS** all of the above inside indented code blocks (4-space indent)
- Returns `{ safe: true }` for clean content
- Returns `{ safe: false, violations: [...] }` with details for flagged content

- [ ] **Step 2: Implement content-guard.js**

Export `checkContent(content)` that:
1. Splits content into prose and code block regions (parse ``` fences and 4-space indentation)
2. Scans only prose regions against injection patterns
3. Returns structured result

Patterns as regex arrays per spec. Each violation includes the pattern category and a snippet.

- [ ] **Step 3: Run tests, verify they pass**

Run: `node --test test/test-content-guard.js`

- [ ] **Step 4: Commit**

```bash
git add src/security/content-guard.js test/test-content-guard.js
git commit -m "feat: content guard with 2026 prompt injection patterns"
```

---

### Task 4: Security — Path guard

**Files:**
- Create: `src/security/path-guard.js`
- Test: `test/test-path-guard.js`

- [ ] **Step 1: Write failing tests**

Create `test/test-path-guard.js` covering:
- `validatePath(filePath, allowedDir)` — accepts paths within allowed dir
- Rejects null bytes in path
- Rejects `../` traversal
- Rejects absolute paths outside allowed dir
- Resolves symlinks and rejects if target is outside allowed dir (use temp dirs with real symlinks)

- [ ] **Step 2: Implement path-guard.js**

Export `validatePath(filePath, allowedDir)` — async, resolves real paths using `fs.promises.realpath`, validates containment.

- [ ] **Step 3: Run tests, verify they pass**

- [ ] **Step 4: Commit**

```bash
git add src/security/path-guard.js test/test-path-guard.js
git commit -m "feat: path guard with traversal and symlink prevention"
```

---

### Task 5: Store — LRU cache

**Files:**
- Create: `src/store/lru-cache.js`
- Test: `test/test-lru-cache.js`

- [ ] **Step 1: Write failing tests**

Create `test/test-lru-cache.js` covering:
- `get(key)` returns `undefined` for missing keys
- `set(key, value)` + `get(key)` returns value
- Evicts least recently used when at capacity
- `get()` promotes entry (prevents eviction)
- TTL expiration — entry returns `undefined` after TTL
- `clear()` empties the cache
- `size` property returns current count

- [ ] **Step 2: Implement lru-cache.js**

Export `class LRUCache { constructor({ maxSize, ttlMs }) }` using a `Map` (insertion order) for O(1) operations. On `get()`, delete and re-insert to promote. On `set()`, evict oldest if at capacity. TTL check on `get()`.

- [ ] **Step 3: Run tests, verify they pass**

- [ ] **Step 4: Commit**

```bash
git add src/store/lru-cache.js test/test-lru-cache.js
git commit -m "feat: LRU cache with TTL and size-based eviction"
```

---

### Task 6: Store — BM25 search index

**Files:**
- Create: `src/store/bm25.js`
- Test: `test/test-bm25.js`

- [ ] **Step 1: Write failing tests**

Create `test/test-bm25.js` covering:
- `index.add(skill, section, content)` — adds document to index
- `index.search(query)` — returns ranked results `[{ skill, section, score, snippet }]`
- Stemming works: searching "configuring" matches "configuration"
- Relevance: exact term match scores higher than partial
- Empty query returns empty results
- Unicode input doesn't crash
- Sub-section chunking: `##` with no `###` is one chunk; `##` with `###` children splits
- `index.stats()` returns `{ chunkCount, uniqueTerms }`
- Snippet is a relevant excerpt (first ~200 chars of matching chunk)

- [ ] **Step 2: Implement bm25.js**

Export `class BM25Index`:
- `add(skill, section, content)` — tokenize, stem, add to inverted index
- `search(query, limit = 10)` — BM25 scoring with K1=1.5, B=0.75
- `clear()` — reset index
- `stats()` — chunk count, unique terms
- Internal: `tokenize(text)`, `stem(word)` (Porter-style suffix stripping), stopword filtering
- Also export `parseSkillSections(content)` — parses markdown into chunks per spec rules (## and ### boundaries, includes heading text)

- [ ] **Step 3: Run tests, verify they pass**

- [ ] **Step 4: Commit**

```bash
git add src/store/bm25.js test/test-bm25.js
git commit -m "feat: BM25 search index with stemming and sub-section chunking"
```

---

### Task 7: Store — Deduplication

**Files:**
- Create: `src/store/dedup.js`
- Test: `test/test-dedup.js`

- [ ] **Step 1: Write failing tests**

Create `test/test-dedup.js` covering:
- `computeHash(content)` — returns SHA-256 hex string
- `checkDuplicate(content, name, existingSkills)` — returns `{ action: 'skip' }` for exact content match
- Returns `{ action: 'update', replaces: 'oldfile.md' }` for same name, different content
- Returns `{ action: 'install' }` for new skill
- `existingSkills` is a Map of `{ name, hash, filename }`

- [ ] **Step 2: Implement dedup.js**

Export `computeHash(content)` and `checkDuplicate(content, name, existingSkills)`. Pure functions, no I/O.

- [ ] **Step 3: Run tests, verify they pass**

- [ ] **Step 4: Commit**

```bash
git add src/store/dedup.js test/test-dedup.js
git commit -m "feat: SHA-256 deduplication for skill installation"
```

---

### Task 8: Store — Skill store

**Files:**
- Create: `src/store/skill-store.js`
- Test: `test/test-skill-store.js`

- [ ] **Step 1: Write failing tests**

Create `test/test-skill-store.js` using temp directories with sample `.md` skill files. Cover:
- `store.load()` — reads skills dir, parses frontmatter, builds BM25 index, verifies integrity
- `store.search(query)` — delegates to BM25
- `store.getSkill(name)` — returns full content (uses LRU cache)
- `store.getSection(name, sectionPath)` — returns specific section
- `store.listSkills()` — returns metadata with cached integrity status
- `store.skillStatus(name)` — returns detailed integrity info
- Dedup on load: two files with same `name` → keep newer, warn
- Frontmatter parsing: extracts name, version, category, description

- [ ] **Step 2: Implement skill-store.js**

Export `class SkillStore { constructor(config, ed25519, pathGuard) }`:
- `async load()` — scan skills dir, parse each `.md`, build index, verify manifest
- `search(query, limit)` — BM25 search
- `async getSkill(name)` — read file (LRU cached), return content
- `getSection(name, sectionPath)` — parse and return specific section
- `listSkills()` — return metadata array with cached integrity
- `skillStatus(name)` — return detailed status
- `async addSkill(filename, content)` — write to skills dir (used by install_pack)
- `async rebuild()` — re-index all skills

Coordinates: BM25Index, LRUCache, dedup, Ed25519 (for integrity), PathGuard (for file access).

Frontmatter parser: split on `---` delimiters, parse YAML-like key-value pairs (simple: no nested objects needed, just strings and arrays).

- [ ] **Step 3: Run tests, verify they pass**

- [ ] **Step 4: Commit**

```bash
git add src/store/skill-store.js test/test-skill-store.js
git commit -m "feat: skill store with indexing, caching, dedup, and integrity"
```

---

### Task 9: Transport — Stdio

**Files:**
- Create: `src/transport/stdio.js`
- Test: `test/test-stdio.js`

- [ ] **Step 1: Write failing tests**

Create `test/test-stdio.js` using `Readable` and `Writable` streams (not actual stdin/stdout) to test:
- Reads NDJSON lines from input stream, emits parsed objects
- Handles partial lines (buffering across chunks)
- Handles multiple messages in one chunk
- Rejects malformed JSON (emits error, doesn't crash)
- `send(object)` writes JSON + newline to output stream
- Handles backpressure (output stream draining)

- [ ] **Step 2: Implement stdio.js**

Export `class StdioTransport { constructor(input, output) }`:
- `onMessage(callback)` — register message handler
- `send(object)` — serialize and write
- `close()` — end streams
- Internal line buffering for NDJSON parsing

Accept `input`/`output` stream params (defaults to `process.stdin`/`process.stdout`) for testability.

- [ ] **Step 3: Run tests, verify they pass**

- [ ] **Step 4: Commit**

```bash
git add src/transport/stdio.js test/test-stdio.js
git commit -m "feat: stdio NDJSON transport"
```

---

### Task 10: Protocol — Dispatcher and MCP lifecycle

**Files:**
- Create: `src/protocol/dispatcher.js`
- Create: `src/protocol/logging.js`
- Test: `test/test-dispatcher.js`

- [ ] **Step 1: Write failing tests**

Create `test/test-dispatcher.js` covering:
- `initialize` request returns server info, protocol version, capabilities (tools, resources, prompts, logging)
- `initialized` notification is accepted silently
- `ping` returns empty result
- Unknown method returns JSON-RPC `-32601` error
- `tools/list` returns tool definitions
- `tools/call` dispatches to correct handler
- `resources/list`, `resources/read` dispatched correctly
- `prompts/list`, `prompts/get` dispatched correctly
- `logging/setLevel` changes the log level
- Rate limiting: after N requests, returns `-32003` error

- [ ] **Step 2: Implement dispatcher.js**

Export `class Dispatcher { constructor(store, config, transport) }`:
- `async handleMessage(message)` — route JSON-RPC to handlers
- Must handle JSON-RPC notifications (messages without `id` field) by processing without sending a response. `initialized` is a notification.
- MCP lifecycle: `initialize` returns `{ protocolVersion, serverInfo, capabilities }`
- Rate limiter: sliding window counter per spec
- Delegates `tools/call` to tool handlers, `resources/*` to resource handlers, etc.

Server info:
```javascript
{
  protocolVersion: '2025-03-26',
  serverInfo: { name: 'mcp-librarian', version: '3.0.0' },
  capabilities: { tools: {}, resources: {}, prompts: {}, logging: {} }
}
```

- [ ] **Step 3: Implement logging.js**

Export `class McpLogger { constructor(transport, level) }`:
- `setLevel(level)` — change log level
- `debug(message, data)`, `info(...)`, `warning(...)`, `error(...)` — emit MCP `notifications/message` via transport if level is enabled
- Log levels: debug < info < warning < error

- [ ] **Step 4: Run tests, verify they pass**

- [ ] **Step 5: Commit**

```bash
git add src/protocol/dispatcher.js src/protocol/logging.js test/test-dispatcher.js
git commit -m "feat: MCP protocol dispatcher with lifecycle, routing, and rate limiting"
```

---

### Task 11: Protocol — Tool handlers

**Files:**
- Create: `src/protocol/tools.js`
- Test: `test/test-tools.js`

- [ ] **Step 1: Write failing tests**

Create `test/test-tools.js` using a mock SkillStore. Cover each tool:
- `find_skill` — calls store.search, returns results
- `find_skill` with missing query — returns INVALID_INPUT error
- `load_section` — calls store.getSection, returns content
- `load_section` with unknown skill — returns SKILL_NOT_FOUND error
- `load_skill` — calls store.getSkill, returns full content
- `list_skills` — calls store.listSkills, returns metadata array
- `skill_status` — calls store.skillStatus, returns integrity details
- `validate_skill` — checks frontmatter, structure, content guard. Returns `{ valid: true }` or `{ valid: false, issues: [...] }`
- `server_status` — returns version, skill count, index stats, uptime
- Tool definitions: each tool has `name`, `description`, `inputSchema` (JSON Schema)

- [ ] **Step 2: Implement tools.js**

Export `function getToolDefinitions()` — returns array of tool schemas.
Export `function handleToolCall(name, args, store, config, logger)` — dispatches to the correct handler.

Each handler is a focused function. `validate_skill` uses content-guard and frontmatter parser directly (no store needed).

- [ ] **Step 3: Run tests, verify they pass**

- [ ] **Step 4: Commit**

```bash
git add src/protocol/tools.js test/test-tools.js
git commit -m "feat: MCP tool handlers — find, load, list, validate, status"
```

---

### Task 12: Protocol — install_pack tool and GitHub fetcher

**Files:**
- Create: `src/protocol/pack-fetcher.js`
- Modify: `src/protocol/tools.js` (add install_pack handler)
- Test: `test/test-tools.js` (add install_pack tests)

- [ ] **Step 1: Write failing tests for pack-fetcher**

Test `pack-fetcher.js` with a mock HTTPS module (or test against actual GitHub if preferred):
- `fetchPackJson(repo, packName)` — returns parsed pack.json
- `fetchSkillFile(repo, packName, filename)` — returns markdown string
- Handles 404 → PACK_NOT_FOUND error
- Handles timeout → PACK_FETCH_FAILED error
- Handles rate limit (403 with rate limit headers) → appropriate error message
- Includes `GITHUB_TOKEN` in headers if env var is set

- [ ] **Step 2: Implement pack-fetcher.js**

Export `class PackFetcher { constructor(config) }`:
- `async fetchPackJson(packName)` — GET raw.githubusercontent.com URL, parse JSON
- `async fetchSkillFile(packName, filename)` — GET raw content
- Internal: `_fetch(url)` using `node:https` with 10s timeout
- Reads `GITHUB_TOKEN` from env for auth header

- [ ] **Step 3: Write failing tests for install_pack tool**

Add to `test/test-tools.js`:
- `install_pack` with valid pack — downloads, validates, deduplicates, writes, re-signs, rebuilds index
- `install_pack` with content guard violation — rejects, no files written
- `install_pack` with duplicate skill — skips, reports as duplicate
- `install_pack` with updated skill — replaces, reports as updated
- `install_pack` where network fails mid-pack (3 skills, 2nd fails) — verify NO partial skills are written to disk
- Returns summary: `{ installed: N, updated: M, skipped: K }`

Use a mock PackFetcher that returns canned responses.

- [ ] **Step 4: Implement install_pack handler**

Add to `tools.js`. Orchestrates: PackFetcher → ContentGuard → Dedup → SkillStore.addSkill → Ed25519.signAllSkills → SkillStore.rebuild.

- [ ] **Step 5: Run all tests**

Run: `node --test test/test-*.js`

- [ ] **Step 6: Commit**

```bash
git add src/protocol/pack-fetcher.js src/protocol/tools.js test/test-tools.js
git commit -m "feat: install_pack tool with GitHub fetcher, validation, and dedup"
```

---

### Task 13: Protocol — Resources and prompts

**Files:**
- Create: `src/protocol/resources.js`
- Create: `src/protocol/prompts.js`
- Test: `test/test-resources.js`

- [ ] **Step 1: Write failing tests**

Create `test/test-resources.js` covering:
- `listResources(store)` — returns array of `{ uri: 'skill://name', name, description, mimeType: 'text/markdown' }`
- `readResource(uri, store)` — returns content for `skill://name`
- `readResource(uri, store)` — returns section content for `skill://name/section-slug`
- Unknown skill URI → SKILL_NOT_FOUND error

- [ ] **Step 2: Implement resources.js**

Export `listResources(store)` and `readResource(uri, store)`.
Parse `skill://` URIs, delegate to store.getSkill or store.getSection.

- [ ] **Step 3: Implement prompts.js**

Export `listPrompts()` and `getPrompt(name, args)`.

`write_skill` prompt: returns a message with the skill format template, frontmatter requirements, section structure guidelines, and content guard rules. Interpolates `args.topic`.

`improve_skill` prompt: returns a message with instructions to review the provided skill content for completeness, structure, and content guard issues. Interpolates `args.content`.

- [ ] **Step 4: Write tests for prompts**

Create `test/test-prompts.js` covering:
- `listPrompts()` returns two prompts with correct names, descriptions, and argument schemas
- `getPrompt('write_skill', { topic: 'React hooks' })` returns a well-formed message containing the topic
- `getPrompt('improve_skill', { content: '...' })` returns a well-formed message containing the content
- Unknown prompt name returns an error

- [ ] **Step 5: Run tests, verify they pass**

Run: `node --test test/test-resources.js test/test-prompts.js`

- [ ] **Step 6: Commit**

```bash
git add src/protocol/resources.js src/protocol/prompts.js test/test-resources.js test/test-prompts.js
git commit -m "feat: MCP resources (skill:// URIs) and prompt templates"
```

---

### Task 14: Entry point and sign CLI

**Files:**
- Create: `bin/mcp-librarian.js`

- [ ] **Step 1: Create bin/mcp-librarian.js**

The entry point that wires everything together:

```javascript
#!/usr/bin/env node
import { loadConfig } from '../src/config/config.js';
import { signAllSkills } from '../src/security/ed25519.js';
import { SkillStore } from '../src/store/skill-store.js';
import { StdioTransport } from '../src/transport/stdio.js';
import { Dispatcher } from '../src/protocol/dispatcher.js';
import { homedir } from 'node:os';
import { join } from 'node:path';

const home = process.env.MCP_LIBRARIAN_HOME || join(homedir(), '.mcp-librarian');
const config = await loadConfig(home);
const args = process.argv.slice(2);

if (args[0] === 'sign') {
  await signAllSkills(config);
  process.exit(0);
}

// Default: start stdio server
const store = new SkillStore(config);
await store.load();
const transport = new StdioTransport(process.stdin, process.stdout);
const dispatcher = new Dispatcher(store, config, transport);
transport.onMessage((msg) => dispatcher.handleMessage(msg));

// Graceful shutdown
process.on('SIGTERM', () => process.exit(0));
process.stdin.on('end', () => process.exit(0));
```

Mark as executable: `chmod +x bin/mcp-librarian.js`

- [ ] **Step 2: Smoke test**

Create a temp skills directory with one test skill. Run:
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","clientInfo":{"name":"test"}}}' | node bin/mcp-librarian.js
```

Verify it outputs a valid JSON-RPC response with server info.

- [ ] **Step 3: Test sign subcommand**

Create temp skills, run `node bin/mcp-librarian.js sign`, verify `manifest.json` is created with signatures.

- [ ] **Step 4: Commit**

```bash
git add bin/mcp-librarian.js
git commit -m "feat: entry point with stdio server and sign CLI subcommand"
```

---

### Task 15: Install script

**Files:**
- Create: `bin/install.js`

- [ ] **Step 1: Create bin/install.js**

JavaScript install script using only `node:` built-ins. Implements:

1. Determine home dir: `process.env.MCP_LIBRARIAN_HOME || ~/.mcp-librarian`
2. Create directory structure: `skills/`, `keys/`
3. Generate Ed25519 keypair, write to `keys/` with `0o600` perms
4. Write skeleton manifest.json
5. Auto-detect MCP clients:
   - Check for `~/.claude.json` or try `claude mcp add` CLI
   - Check for `~/.cursor/mcp.json`
   - Check for `~/.windsurf/mcp.json`
6. For each detected client, prompt user (via `node:readline`) to configure
7. For undetected clients, print manual instructions

Use `node:readline` for interactive prompts. Use `node:child_process` (execSync) only for `claude mcp add` detection.

- [ ] **Step 2: Test install script manually**

Run: `MCP_LIBRARIAN_HOME=/tmp/test-install node bin/install.js`
Verify: directory structure created, keys generated, skeleton manifest written.

- [ ] **Step 3: Commit**

```bash
git add bin/install.js
git commit -m "feat: install script with key generation and MCP client auto-detection"
```

---

### Task 16: Rate limiter (extended tests)

Note: The basic rate limiter is implemented in Task 10 as part of the dispatcher (the dispatcher tests already cover the basic limit/block behavior). This task adds thorough edge-case coverage in a dedicated test file.

**Files:**
- Test: `test/test-rate-limiter.js`

- [ ] **Step 1: Create dedicated rate limiter tests**

Create `test/test-rate-limiter.js` covering edge cases beyond Task 10's basic tests:
- Allows requests under the limit
- Blocks requests over the limit with `-32003` error
- Window resets after windowMs
- Returns reset time in error

- [ ] **Step 2: Run tests**

- [ ] **Step 3: Commit**

```bash
git add test/test-rate-limiter.js
git commit -m "test: rate limiter window tracking and enforcement"
```

---

### Task 17: CI, README, and final verification

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `README.md`

- [ ] **Step 1: Create CI workflow**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest]
        node: [22]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
      - run: npm test
```

- [ ] **Step 2: Create README.md**

Comprehensive README covering:
- What it is (one paragraph)
- Quick start (clone, install, use)
- How it works (architecture overview)
- Available tools (table from spec)
- Skill format (with example)
- Installing skill packs
- Writing your own skills
- Configuration (env vars table)
- Security model (Ed25519, content guard)
- MCP client setup (Claude Code, Cursor, Windsurf, manual)
- Contributing
- License

- [ ] **Step 3: Run full test suite**

```bash
node --test test/test-*.js
```

Expected: All tests pass. Count should be 80+ tests across all files.

- [ ] **Step 4: Smoke test end-to-end**

Run the full server with a test skill and pipe MCP commands:

```bash
# Create test environment
export MCP_LIBRARIAN_HOME=/tmp/mcp-test
mkdir -p $MCP_LIBRARIAN_HOME/skills $MCP_LIBRARIAN_HOME/keys
# Generate keys
node -e "import('./src/security/ed25519.js').then(m => m.generateKeypair('$MCP_LIBRARIAN_HOME/keys'))"

# Create a test skill
cat > $MCP_LIBRARIAN_HOME/skills/test.md << 'SKILL'
---
name: test-skill
version: 1.0.0
category: [testing]
description: A test skill for verification
---

## Getting Started

This is a test skill for the mcp-librarian server.

### Installation

Run the install command.
SKILL

# Sign it
node bin/mcp-librarian.js sign

# Test initialize
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","clientInfo":{"name":"test","version":"1.0"}}}' | node bin/mcp-librarian.js

# Test find_skill
echo -e '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","clientInfo":{"name":"test","version":"1.0"}}}\n{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"find_skill","arguments":{"query":"install"}}}' | node bin/mcp-librarian.js
```

Verify valid JSON-RPC responses for each.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml README.md
git commit -m "feat: CI workflow, README documentation, final verification"
```

---

### Task 18: Push to penumbraforge GitHub

Note: The `penumbraforge/mcp-librarian` repo may not exist yet on GitHub. If an old v2 repo exists under `rngdz`, it stays there — this is a new repo under the `penumbraforge` account.

The community skills repo (`penumbraforge/mcp-librarian-skills`) is a separate deliverable and will be planned/created in a follow-up session.

- [ ] **Step 1: Create repo on GitHub**

```bash
gh auth switch --user penumbraforge
gh repo create penumbraforge/mcp-librarian --public --description "Zero-dependency MCP skills server — BM25 search, Ed25519 integrity, progressive disclosure"
```

- [ ] **Step 2: Add remote and push**

```bash
cd ~/penumbraprojects/mcp-librarian-v3
git remote add origin https://github.com/penumbraforge/mcp-librarian.git
git push -u origin main
```

- [ ] **Step 3: Verify CI passes**

Check GitHub Actions — tests should run on macOS + Ubuntu.

- [ ] **Step 4: Tag release**

```bash
git tag v3.0.0
git push origin v3.0.0
```
