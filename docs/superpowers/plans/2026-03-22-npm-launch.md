# mcp-librarian npm Launch — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make mcp-librarian installable via `npm install -g mcp-librarian` with a `mcp-librarian setup` command that auto-configures everything, bundling 10 useful skills and supporting GitHub-based skill packs.

**Architecture:** Unified CLI entry point (`bin/cli.js`) routes subcommands to dedicated handler modules in `src/cli/`. Server resolves all writable state from `~/.mcp-librarian/` instead of the package root. SkillStore loads skills from multiple directories. Bundled skills are copied during setup.

**Tech Stack:** Node.js >= 22, ESM modules, built-in `node:crypto` / `node:fs` / `node:net` / `node:child_process`. Zero external dependencies.

**Spec:** `docs/superpowers/specs/2026-03-22-npm-launch-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|----------------|
| `bin/cli.js` | Unified CLI entry point — shebang, subcommand parser, routes to handlers |
| `src/cli/paths.js` | Shared path resolution: `LIB_DIR`, `SKILLS_DIR`, `PACKS_DIR`, `STAGING_DIR`, respects `$XDG_DATA_HOME` on Linux |
| `src/cli/setup.js` | Keygen, skill copying, manifest signing, client detection, service install |
| `src/cli/service.js` | Platform detection, launchd/systemd install/unload/start/stop/status |
| `src/cli/packs.js` | `install-pack`, `update-pack`, `list-packs`, `remove-pack` via git clone |
| `src/cli/skills.js` | `create-skill` scaffolding into `~/.mcp-librarian/skills/` |
| `src/cli/uninstall.js` | Remove runtime dir, services, client configs |
| `config/systemd.service.template` | systemd user unit with placeholder substitution |
| `skills/git/SKILL.md` | Git skill (workflows, rebasing, hooks, monorepos) |
| `skills/docker/SKILL.md` | Docker skill (Dockerfile, compose, multi-stage, debugging) |
| `skills/sql/SKILL.md` | SQL skill (optimization, indexing, migrations, pitfalls) |
| `skills/api-design/SKILL.md` | API design skill (REST, errors, pagination, auth) |
| `skills/testing/SKILL.md` | Testing skill (strategies, mocking, CI, coverage) |
| `skills/debugging/SKILL.md` | Debugging skill (systematic approaches, profiling, memory) |
| `skills/security/SKILL.md` | Security skill (OWASP top 10 with fixes) |
| `test/test-cli.js` | Tests for CLI subcommand parsing |
| `test/test-setup.js` | Tests for setup flow (mock filesystem) |
| `test/test-service.js` | Tests for service detection/management |
| `test/test-packs.js` | Tests for pack install/list/remove |

### Modified Files

| File | Change |
|------|--------|
| `bin/mcp-librarian.js:40-41` | `SKILLS_DIR` and `STAGING_DIR` resolve from `LIB_DIR` instead of `PROJECT_ROOT` |
| `bin/mcp-librarian.js:54` | Error message says "run mcp-librarian setup" instead of "run bin/install.sh" |
| `bin/mcp-librarian.js:60-68` | Version banner reads from package.json, add PID file write |
| `bin/mcp-librarian-stdio.js:19` | Use shared path resolution from `src/cli/paths.js` |
| `src/store/skill-store.js:10-17` | Constructor accepts array of skill directories |
| `src/store/skill-store.js:19-20` | `loadManifest()` reads from `LIB_DIR` instead of `skillsDir` |
| `src/store/skill-store.js:28-54` | `loadAll()` scans multiple directories |
| `src/store/skill-store.js:90` | Error message says "run mcp-librarian setup" |
| `package.json` | Update name, version, bin, files, description |
| `README.md` | Full rewrite for npm-first install instructions |

### Removed from Bundle

| File | Action |
|------|--------|
| `skills/redteam/` | Delete from repo (available as separate pack later) |
| `skills/unbias/` | Delete from repo (available as separate pack later) |

---

## Task 1: Shared Path Resolution (`src/cli/paths.js`)

Everything downstream depends on consistent path resolution. This must come first.

**Files:**
- Create: `src/cli/paths.js`
- Test: `test/test-cli.js`

- [ ] **Step 1: Write the failing test**

```js
// test/test-cli.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('paths', () => {
  it('resolves LIB_DIR to ~/.mcp-librarian by default', async () => {
    const { getLibDir } = await import('../src/cli/paths.js');
    const { homedir } = await import('node:os');
    const { join } = await import('node:path');
    assert.equal(getLibDir(), join(homedir(), '.mcp-librarian'));
  });

  it('resolves SKILLS_DIR under LIB_DIR', async () => {
    const { getSkillsDir } = await import('../src/cli/paths.js');
    const { homedir } = await import('node:os');
    const { join } = await import('node:path');
    assert.equal(getSkillsDir(), join(homedir(), '.mcp-librarian', 'skills'));
  });

  it('resolves PACKS_DIR under LIB_DIR', async () => {
    const { getPacksDir } = await import('../src/cli/paths.js');
    const { homedir } = await import('node:os');
    const { join } = await import('node:path');
    assert.equal(getPacksDir(), join(homedir(), '.mcp-librarian', 'packs'));
  });

  it('resolves STAGING_DIR under LIB_DIR', async () => {
    const { getStagingDir } = await import('../src/cli/paths.js');
    const { homedir } = await import('node:os');
    const { join } = await import('node:path');
    assert.equal(getStagingDir(), join(homedir(), '.mcp-librarian', 'staging'));
  });

  it('returns bundled skills dir relative to package root', async () => {
    const { getBundledSkillsDir } = await import('../src/cli/paths.js');
    const result = getBundledSkillsDir();
    assert.ok(result.endsWith('/skills') || result.endsWith('\\skills'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/test-cli.js`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```js
// src/cli/paths.js
/**
 * Shared path resolution for CLI and server.
 * All writable state lives under LIB_DIR (~/.mcp-librarian).
 * On Linux, respects $XDG_DATA_HOME if set.
 */

import { homedir, platform } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(__dirname, '..', '..');

export function getLibDir() {
  if (platform() === 'linux' && process.env.XDG_DATA_HOME) {
    return join(process.env.XDG_DATA_HOME, 'mcp-librarian');
  }
  return join(homedir(), '.mcp-librarian');
}

export function getSkillsDir() {
  return join(getLibDir(), 'skills');
}

export function getPacksDir() {
  return join(getLibDir(), 'packs');
}

export function getStagingDir() {
  return join(getLibDir(), 'staging');
}

export function getManifestPath() {
  return join(getLibDir(), 'manifest.json');
}

export function getSocketPath() {
  return join(getLibDir(), 'librarian.sock');
}

export function getPidPath() {
  return join(getLibDir(), 'librarian.pid');
}

export function getBundledSkillsDir() {
  return join(PACKAGE_ROOT, 'skills');
}

export function getConfigPath() {
  return join(PACKAGE_ROOT, 'config', 'default.json');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/test-cli.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/paths.js test/test-cli.js
git commit -m "feat: add shared path resolution for CLI and server"
```

---

## Task 2: Unified CLI Entry Point (`bin/cli.js`)

Routes subcommands to handler modules. Thin dispatcher — no business logic here.

**Files:**
- Create: `bin/cli.js`
- Test: `test/test-cli.js` (append)

- [ ] **Step 1: Write the failing test**

Append to `test/test-cli.js`:

```js
describe('CLI parser', () => {
  it('parses setup command', async () => {
    const { parseArgs } = await import('../src/cli/parse-args.js');
    const result = parseArgs(['setup']);
    assert.equal(result.command, 'setup');
    assert.deepEqual(result.flags, {});
  });

  it('parses setup with flags', async () => {
    const { parseArgs } = await import('../src/cli/parse-args.js');
    const result = parseArgs(['setup', '--dry-run', '--skip-clients']);
    assert.equal(result.command, 'setup');
    assert.equal(result.flags['dry-run'], true);
    assert.equal(result.flags['skip-clients'], true);
  });

  it('parses setup --only with value', async () => {
    const { parseArgs } = await import('../src/cli/parse-args.js');
    const result = parseArgs(['setup', '--only', 'claude-code']);
    assert.equal(result.flags.only, 'claude-code');
  });

  it('parses install-pack with positional arg', async () => {
    const { parseArgs } = await import('../src/cli/parse-args.js');
    const result = parseArgs(['install-pack', 'penumbraforge/starter']);
    assert.equal(result.command, 'install-pack');
    assert.deepEqual(result.args, ['penumbraforge/starter']);
  });

  it('parses start command', async () => {
    const { parseArgs } = await import('../src/cli/parse-args.js');
    const result = parseArgs(['start']);
    assert.equal(result.command, 'start');
  });

  it('defaults to help with no args', async () => {
    const { parseArgs } = await import('../src/cli/parse-args.js');
    const result = parseArgs([]);
    assert.equal(result.command, 'help');
  });

  it('parses uninstall --yes', async () => {
    const { parseArgs } = await import('../src/cli/parse-args.js');
    const result = parseArgs(['uninstall', '--yes']);
    assert.equal(result.command, 'uninstall');
    assert.equal(result.flags.yes, true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/test-cli.js`
Expected: FAIL — module not found

- [ ] **Step 3: Write the arg parser**

Create `src/cli/parse-args.js`:

```js
/**
 * Minimal argument parser for CLI subcommands.
 * No dependencies. Supports --flag, --key value, and positional args.
 */

const VALID_COMMANDS = [
  'setup', 'start', 'stop', 'restart', 'status',
  'uninstall', 'install-pack', 'update-pack', 'list-packs',
  'remove-pack', 'create-skill', 'export-pack', 'help', 'version',
];

// Flags that take a value argument (not boolean)
const VALUE_FLAGS = ['only'];

export function parseArgs(argv) {
  if (argv.length === 0) return { command: 'help', flags: {}, args: [] };

  const command = VALID_COMMANDS.includes(argv[0]) ? argv[0] : 'help';
  const flags = {};
  const args = [];

  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      if (VALUE_FLAGS.includes(key) && i + 1 < argv.length) {
        flags[key] = argv[++i];
      } else {
        flags[key] = true;
      }
    } else {
      args.push(arg);
    }
  }

  return { command, flags, args };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/test-cli.js`
Expected: PASS

- [ ] **Step 5: Write `bin/cli.js` entry point**

```js
#!/usr/bin/env node

/**
 * mcp-librarian CLI — Unified entry point.
 * Routes subcommands to handler modules.
 *
 * Penumbra Forge | MIT License
 */

import { parseArgs } from '../src/cli/parse-args.js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));

const argv = process.argv.slice(2);
const { command, flags, args } = parseArgs(argv);

async function run() {
  switch (command) {
    case 'setup': {
      const { runSetup } = await import('../src/cli/setup.js');
      await runSetup(flags);
      break;
    }
    case 'start': {
      // Delegate to the existing server bootstrap
      await import('./mcp-librarian.js');
      break;
    }
    case 'stop': {
      const { stopService } = await import('../src/cli/service.js');
      await stopService();
      break;
    }
    case 'restart': {
      const { restartService } = await import('../src/cli/service.js');
      await restartService();
      break;
    }
    case 'status': {
      const { showStatus } = await import('../src/cli/service.js');
      await showStatus();
      break;
    }
    case 'uninstall': {
      const { runUninstall } = await import('../src/cli/uninstall.js');
      await runUninstall(flags);
      break;
    }
    case 'install-pack': {
      const { installPack } = await import('../src/cli/packs.js');
      if (!args[0]) { console.error('Usage: mcp-librarian install-pack <github-user/repo>'); process.exit(1); }
      await installPack(args[0]);
      break;
    }
    case 'update-pack': {
      const { updatePack } = await import('../src/cli/packs.js');
      if (!args[0]) { console.error('Usage: mcp-librarian update-pack <pack-name>'); process.exit(1); }
      await updatePack(args[0]);
      break;
    }
    case 'list-packs': {
      const { listPacks } = await import('../src/cli/packs.js');
      await listPacks();
      break;
    }
    case 'remove-pack': {
      const { removePack } = await import('../src/cli/packs.js');
      if (!args[0]) { console.error('Usage: mcp-librarian remove-pack <pack-name>'); process.exit(1); }
      await removePack(args[0]);
      break;
    }
    case 'create-skill': {
      const { createSkill } = await import('../src/cli/skills.js');
      if (!args[0]) { console.error('Usage: mcp-librarian create-skill <name>'); process.exit(1); }
      await createSkill(args[0]);
      break;
    }
    case 'export-pack': {
      const { exportPack } = await import('../src/cli/packs.js');
      if (!args[0]) { console.error('Usage: mcp-librarian export-pack <output-dir>'); process.exit(1); }
      await exportPack(args[0]);
      break;
    }
    case 'version':
      console.log(`mcp-librarian v${pkg.version}`);
      break;
    case 'help':
    default:
      console.log(`
  mcp-librarian v${pkg.version} — Penumbra Forge

  Usage: mcp-librarian <command> [options]

  Commands:
    setup              Generate keys, sign skills, configure MCP clients & service
    start              Start the server (foreground)
    stop               Stop the running service
    restart            Restart the service
    status             Show server and service status
    uninstall          Remove runtime files, services, and client configs

    install-pack <user/repo>   Install a skill pack from GitHub
    update-pack <name>         Update an installed pack
    list-packs                 List installed packs
    remove-pack <name>         Remove an installed pack
    create-skill <name>        Scaffold a new skill
    export-pack <dir>          Bundle skills for sharing

  Setup flags:
    --dry-run          Preview changes without applying
    --skip-clients     Skip MCP client auto-configuration
    --skip-service     Skip service installation
    --only <client>    Configure only one client (claude-code, cclocal, crush)
    --force-keygen     Regenerate keys even if they exist

  Examples:
    npm install -g mcp-librarian
    mcp-librarian setup
    mcp-librarian install-pack penumbraforge/devops-pack
`);
      break;
  }
}

run().catch(e => {
  console.error(`[mcp-librarian] ${e.message}`);
  process.exit(1);
});
```

- [ ] **Step 6: Make cli.js executable**

Run: `chmod +x bin/cli.js`

- [ ] **Step 7: Commit**

```bash
git add src/cli/parse-args.js bin/cli.js
git commit -m "feat: add unified CLI entry point with subcommand routing"
```

---

## Task 3: Update Server to Resolve Paths from `~/.mcp-librarian/`

Modify the server bootstrap and skill store to use the shared path module.

**Files:**
- Modify: `bin/mcp-librarian.js:38-41,54,60-68`
- Modify: `src/store/skill-store.js:10-17,19-20,28-54,90`
- Modify: `bin/mcp-librarian-stdio.js:19`
- Test: run existing tests to verify no regression

- [ ] **Step 1: Run existing tests to establish baseline**

Run: `node --test test/test-*.js`
Expected: All 89 tests PASS

- [ ] **Step 2: Update `bin/mcp-librarian.js` path resolution**

Change lines 34-41 to:

```js
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');

// Paths — all writable state under LIB_DIR
const LIB_DIR = join(homedir(), '.mcp-librarian');
const SOCKET_PATH = join(LIB_DIR, 'librarian.sock');
const SKILLS_DIR = join(LIB_DIR, 'skills');
const STAGING_DIR = join(LIB_DIR, 'staging');
const PID_PATH = join(LIB_DIR, 'librarian.pid');
```

- [ ] **Step 3: Add PID file write and version from package.json**

After `await server.start();` (line 164), add:

```js
import { writeFileSync, unlinkSync } from 'node:fs';
// ... (move to imports at top)
writeFileSync(PID_PATH, String(process.pid), { mode: 0o644 });
```

In the `shutdown` function, before `process.exit(0)`, add:

```js
try { unlinkSync(PID_PATH); } catch {}
```

Update the version banner to read from `package.json`:

```js
const pkg = JSON.parse(readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf8'));
```

Then use `pkg.version` in the banner. Update the error message on line 54 from "run bin/install.sh first" to "run `mcp-librarian setup` first".

- [ ] **Step 4: Update `src/store/skill-store.js` for multi-directory loading**

Modify constructor to accept an array of skill directories:

```js
export class SkillStore {
  constructor(skillsDirs, opts = {}) {
    // Accept single dir (string) or array of dirs
    this.skillsDirs = Array.isArray(skillsDirs) ? skillsDirs : [skillsDirs];
    this.manifestPath = opts.manifestPath || null;
    this.publicKey = opts.publicKey || null;
    this.cache = new LRUCache({ maxSize: opts.cacheMaxSize ?? 100, ttlMs: opts.cacheTtl ?? 600_000 });
    this.bm25 = new BM25();
    this.skills = new Map();
    this.manifest = null;
  }

  loadManifest() {
    const manifestPath = this.manifestPath || join(this.skillsDirs[0], 'manifest.json');
    if (existsSync(manifestPath)) {
      this.manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } else {
      this.manifest = { skills: {} };
    }
  }

  loadAll() {
    this.skills.clear();
    this.cache.clear();
    this.loadManifest();

    const allSections = [];

    for (const skillsDir of this.skillsDirs) {
      if (!existsSync(skillsDir)) continue;
      const entries = readdirSync(skillsDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const skillPath = join(skillsDir, entry.name, 'SKILL.md');
        if (!existsSync(skillPath)) continue;

        try {
          const name = sanitizeSkillName(entry.name);
          if (this.skills.has(name)) continue; // first dir wins (user > pack)
          const content = readFileSync(skillPath, 'utf8');
          const parsed = parseSkill(content, name);
          parsed._raw = content;
          this.skills.set(name, parsed);
          allSections.push(...parsed.sections);
        } catch (e) {
          console.error(`[skill-store] Failed to load ${entry.name}: ${e.message}`);
        }
      }
    }

    this.bm25.index(allSections);
    return this.skills.size;
  }
```

Update the error in `getSkill()` from "run install.sh" to "run `mcp-librarian setup`".

- [ ] **Step 5: Update `bin/mcp-librarian.js` to pass multi-directory and manifest path**

```js
// Build skill directories: user skills + pack skills
const skillDirs = [SKILLS_DIR];
const packsDir = join(LIB_DIR, 'packs');
if (existsSync(packsDir)) {
  const packEntries = readdirSync(packsDir, { withFileTypes: true });
  for (const entry of packEntries) {
    if (entry.isDirectory()) {
      const packSkills = join(packsDir, entry.name, 'skills');
      if (existsSync(packSkills)) skillDirs.push(packSkills);
    }
  }
}

const MANIFEST_PATH = join(LIB_DIR, 'manifest.json');

const store = new SkillStore(skillDirs, {
  publicKey,
  manifestPath: MANIFEST_PATH,
});
```

Also update the `Librarian` constructor call to pass `manifestPath` so the IntegrityEngine writes to `~/.mcp-librarian/manifest.json` instead of `~/.mcp-librarian/skills/manifest.json`:

```js
const librarian = new Librarian({
  skillsDir: SKILLS_DIR,
  stagingDir: STAGING_DIR,
  store,
  auditLog,
  publicKey,
  privateKey,
  manifestPath: MANIFEST_PATH,
});
```

This requires a small change to `src/librarian/index.js` — the Librarian constructor should pass `opts.manifestPath` through to the IntegrityEngine, overriding `engine.manifestPath` if provided.

- [ ] **Step 5b: Update `src/librarian/index.js` to accept `manifestPath` option**

In the Librarian constructor, after creating the IntegrityEngine, add:

```js
if (opts.manifestPath) {
  this.integrity.manifestPath = opts.manifestPath;
}
```

- [ ] **Step 5c: Update `bin/mcp-librarian-stdio.js` to use shared path resolution**

Replace lines 19-21:

```js
// Old:
const LIB_DIR = join(homedir(), '.mcp-librarian');
const SOCKET_PATH = join(LIB_DIR, 'librarian.sock');
const SECRET_PATH = join(LIB_DIR, 'client.secret');

// New:
import { getLibDir, getSocketPath } from '../src/cli/paths.js';
const LIB_DIR = getLibDir();
const SOCKET_PATH = getSocketPath();
const SECRET_PATH = join(LIB_DIR, 'client.secret');
```

Remove the `homedir` import from `node:os` since it's no longer needed directly.

- [ ] **Step 6: Run existing tests to verify no regression**

Run: `node --test test/test-*.js`
Expected: All tests PASS. Some tests construct `SkillStore` directly — they may need the string form (backward compatible via the Array.isArray check).

- [ ] **Step 7: Commit**

```bash
git add bin/mcp-librarian.js bin/mcp-librarian-stdio.js src/store/skill-store.js
git commit -m "refactor: resolve skills/staging/manifest from ~/.mcp-librarian, support multi-directory loading"
```

---

## Task 4: Setup Command — Keygen & Skill Copying (`src/cli/setup.js`)

The core of the setup flow: create runtime dir, generate keys, copy bundled skills, sign manifest.

**Note:** `runSetup()` dynamically imports `./service.js` and `./setup-clients.js` (created in Task 5). The exported functions `generateKeys`, `generateSecrets`, `copyBundledSkills`, and `signAllSkills` are independently testable without Task 5. The full `runSetup()` flow only works after Task 5 is complete.

**Files:**
- Create: `src/cli/setup.js`
- Test: `test/test-setup.js`

- [ ] **Step 1: Write failing tests for keygen and skill copy**

```js
// test/test-setup.js
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('setup', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'mcp-librarian-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('generates Ed25519 keypair', async () => {
    const { generateKeys } = await import('../src/cli/setup.js');
    await generateKeys(tempDir, {});
    assert.ok(existsSync(join(tempDir, 'ed25519.pub')));
    assert.ok(existsSync(join(tempDir, 'ed25519.priv')));
  });

  it('skips keygen if keys exist', async () => {
    const { generateKeys } = await import('../src/cli/setup.js');
    writeFileSync(join(tempDir, 'ed25519.pub'), 'existing');
    writeFileSync(join(tempDir, 'ed25519.priv'), 'existing');
    await generateKeys(tempDir, {});
    assert.equal(readFileSync(join(tempDir, 'ed25519.pub'), 'utf8'), 'existing');
  });

  it('regenerates keys with --force-keygen', async () => {
    const { generateKeys } = await import('../src/cli/setup.js');
    writeFileSync(join(tempDir, 'ed25519.pub'), 'existing');
    writeFileSync(join(tempDir, 'ed25519.priv'), 'existing');
    await generateKeys(tempDir, { 'force-keygen': true });
    assert.notEqual(readFileSync(join(tempDir, 'ed25519.pub'), 'utf8'), 'existing');
  });

  it('generates HMAC secrets', async () => {
    const { generateSecrets } = await import('../src/cli/setup.js');
    await generateSecrets(tempDir, {});
    assert.ok(existsSync(join(tempDir, 'client.secret')));
    assert.ok(existsSync(join(tempDir, 'librarian.secret')));
    assert.ok(existsSync(join(tempDir, 'audit.secret')));
    // Verify 256-bit (64 hex chars)
    const secret = readFileSync(join(tempDir, 'client.secret'), 'utf8').trim();
    assert.equal(secret.length, 64);
    assert.match(secret, /^[0-9a-f]+$/);
  });

  it('copies bundled skills to target dir', async () => {
    const { copyBundledSkills } = await import('../src/cli/setup.js');
    const bundledDir = join(tempDir, 'bundled');
    const targetDir = join(tempDir, 'skills');
    mkdirSync(bundledDir);
    mkdirSync(join(bundledDir, 'test-skill'), { recursive: true });
    writeFileSync(join(bundledDir, 'test-skill', 'SKILL.md'), '---\nname: test\n---\n## X\nContent');
    await copyBundledSkills(bundledDir, targetDir);
    assert.ok(existsSync(join(targetDir, 'test-skill', 'SKILL.md')));
  });

  it('does not overwrite user-modified skills', async () => {
    const { copyBundledSkills } = await import('../src/cli/setup.js');
    const bundledDir = join(tempDir, 'bundled');
    const targetDir = join(tempDir, 'skills');
    mkdirSync(join(bundledDir, 'test-skill'), { recursive: true });
    mkdirSync(join(targetDir, 'test-skill'), { recursive: true });
    writeFileSync(join(bundledDir, 'test-skill', 'SKILL.md'), 'bundled version');
    writeFileSync(join(targetDir, 'test-skill', 'SKILL.md'), 'user modified version');
    await copyBundledSkills(bundledDir, targetDir);
    assert.equal(readFileSync(join(targetDir, 'test-skill', 'SKILL.md'), 'utf8'), 'user modified version');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/test-setup.js`
Expected: FAIL — module not found

- [ ] **Step 3: Write `src/cli/setup.js`**

```js
/**
 * mcp-librarian setup — generates keys, copies skills, signs manifest,
 * configures MCP clients, installs platform service.
 *
 * All functions accept an explicit libDir for testability.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, cpSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { getLibDir, getSkillsDir, getPacksDir, getStagingDir, getBundledSkillsDir, getManifestPath } from './paths.js';
import { IntegrityEngine } from '../librarian/integrity.js';
import { ensureDir } from '../security/permissions.js';

export async function generateKeys(libDir, flags) {
  const pubPath = join(libDir, 'ed25519.pub');
  const privPath = join(libDir, 'ed25519.priv');

  if (existsSync(pubPath) && existsSync(privPath) && !flags['force-keygen']) {
    console.log('  Keys already exist, skipping (use --force-keygen to regenerate)');
    return;
  }

  const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  writeFileSync(pubPath, publicKey, { mode: 0o600 });
  writeFileSync(privPath, privateKey, { mode: 0o600 });
  console.log('  Ed25519 keypair generated');
}

export async function generateSecrets(libDir, flags) {
  const secrets = ['client.secret', 'librarian.secret', 'audit.secret'];

  for (const name of secrets) {
    const path = join(libDir, name);
    if (existsSync(path) && !flags['force-keygen']) continue;
    writeFileSync(path, randomBytes(32).toString('hex'), { mode: 0o600 });
  }

  console.log('  HMAC secrets ready');
}

export async function copyBundledSkills(bundledDir, targetDir) {
  if (!existsSync(bundledDir)) return;
  mkdirSync(targetDir, { recursive: true });

  const entries = readdirSync(bundledDir, { withFileTypes: true });
  let copied = 0;
  let skipped = 0;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const srcSkill = join(bundledDir, entry.name, 'SKILL.md');
    if (!existsSync(srcSkill)) continue;

    const destDir = join(targetDir, entry.name);
    const destSkill = join(destDir, 'SKILL.md');

    // Don't overwrite user-modified skills
    if (existsSync(destSkill)) {
      skipped++;
      continue;
    }

    mkdirSync(destDir, { recursive: true });
    cpSync(srcSkill, destSkill);
    copied++;
  }

  console.log(`  Skills: ${copied} copied, ${skipped} already exist`);
}

export async function signAllSkills(libDir, skillsDir, packsDir) {
  const pubKey = readFileSync(join(libDir, 'ed25519.pub'), 'utf8');
  const privKey = readFileSync(join(libDir, 'ed25519.priv'), 'utf8');

  const manifestPath = join(libDir, 'manifest.json');
  const engine = new IntegrityEngine(libDir, pubKey, privKey);
  // Override manifest path to write to libDir
  engine.manifestPath = manifestPath;

  const contents = {};

  // Collect from skills dir
  if (existsSync(skillsDir)) {
    for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const p = join(skillsDir, entry.name, 'SKILL.md');
      if (existsSync(p)) contents[entry.name] = readFileSync(p, 'utf8');
    }
  }

  // Collect from packs
  if (existsSync(packsDir)) {
    for (const pack of readdirSync(packsDir, { withFileTypes: true })) {
      if (!pack.isDirectory()) continue;
      const packSkills = join(packsDir, pack.name, 'skills');
      if (!existsSync(packSkills)) continue;
      for (const entry of readdirSync(packSkills, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const p = join(packSkills, entry.name, 'SKILL.md');
        if (existsSync(p) && !contents[entry.name]) {
          contents[entry.name] = readFileSync(p, 'utf8');
        }
      }
    }
  }

  const manifest = engine.signAll(contents);
  console.log(`  Signed ${Object.keys(manifest.skills).length} skills`);
}

export async function runSetup(flags) {
  if (flags['dry-run']) {
    console.log('[mcp-librarian] Dry run — showing what would happen:\n');
  }

  const libDir = getLibDir();
  const skillsDir = getSkillsDir();
  const packsDir = getPacksDir();
  const stagingDir = getStagingDir();
  const bundledDir = getBundledSkillsDir();

  console.log('');
  console.log('  \x1b[1mmcp-librarian setup\x1b[0m');
  console.log(`  Runtime:  ${libDir}`);
  console.log(`  Bundled:  ${bundledDir}`);
  console.log('');

  // 1. Create runtime directories
  console.log('[1/6] Creating runtime directories...');
  if (!flags['dry-run']) {
    ensureDir(libDir, 0o700);
    mkdirSync(skillsDir, { recursive: true });
    mkdirSync(packsDir, { recursive: true });
    mkdirSync(stagingDir, { recursive: true });
  }

  // 2. Generate keys
  console.log('[2/6] Generating cryptographic material...');
  if (!flags['dry-run']) {
    await generateKeys(libDir, flags);
    await generateSecrets(libDir, flags);
  }

  // 3. Copy bundled skills
  console.log('[3/6] Installing bundled skills...');
  if (!flags['dry-run']) {
    await copyBundledSkills(bundledDir, skillsDir);
  }

  // 4. Sign all skills
  console.log('[4/6] Signing skill manifest...');
  if (!flags['dry-run']) {
    await signAllSkills(libDir, skillsDir, packsDir);
  }

  // 5. Install service
  if (!flags['skip-service']) {
    console.log('[5/6] Installing service...');
    if (!flags['dry-run']) {
      const { installService } = await import('./service.js');
      await installService();
    }
  } else {
    console.log('[5/6] Skipping service install (--skip-service)');
  }

  // 6. Configure MCP clients
  if (!flags['skip-clients']) {
    console.log('[6/6] Configuring MCP clients...');
    if (!flags['dry-run']) {
      const { configureClients } = await import('./setup-clients.js');
      await configureClients(flags);
    }
  } else {
    console.log('[6/6] Skipping client config (--skip-clients)');
  }

  console.log('');
  console.log('\x1b[32m  Setup complete.\x1b[0m');
  console.log(`  Start: mcp-librarian start`);
  console.log(`  Status: mcp-librarian status`);
  console.log('');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/test-setup.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/setup.js test/test-setup.js
git commit -m "feat: add setup command — keygen, skill copying, manifest signing"
```

---

## Task 5: Service Management (`src/cli/service.js`)

Platform-aware service install, start, stop, restart, status.

**Files:**
- Create: `src/cli/service.js`
- Create: `src/cli/setup-clients.js`
- Create: `config/systemd.service.template`
- Test: `test/test-service.js`

- [ ] **Step 1: Write failing tests**

```js
// test/test-service.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('service', () => {
  it('detectPlatform returns darwin or linux', async () => {
    const { detectPlatform } = await import('../src/cli/service.js');
    const platform = detectPlatform();
    assert.ok(['darwin', 'linux'].includes(platform));
  });

  it('getPlistPath returns correct macOS path', async () => {
    const { getPlistPath } = await import('../src/cli/service.js');
    const { homedir } = await import('node:os');
    const result = getPlistPath();
    assert.ok(result.includes('Library/LaunchAgents') || result.includes('.config/systemd'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/test-service.js`
Expected: FAIL — module not found

- [ ] **Step 3: Write `src/cli/service.js`**

```js
/**
 * Platform service management — launchd (macOS) and systemd (Linux).
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir, platform as osPlatform } from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getLibDir, getPidPath, getSocketPath } from './paths.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(__dirname, '..', '..');

const PLIST_LABEL = 'com.mcp-librarian.server';
const SYSTEMD_UNIT = 'mcp-librarian.service';

export function detectPlatform() {
  return osPlatform();
}

export function getPlistPath() {
  if (osPlatform() === 'darwin') {
    return join(homedir(), 'Library', 'LaunchAgents', `${PLIST_LABEL}.plist`);
  }
  return join(homedir(), '.config', 'systemd', 'user', SYSTEMD_UNIT);
}

export async function installService() {
  const platform = detectPlatform();

  if (platform === 'darwin') {
    await installLaunchd();
  } else if (platform === 'linux') {
    await installSystemd();
  } else {
    console.log('  Service install not supported on this platform');
    console.log('  Run manually: mcp-librarian start');
  }
}

async function installLaunchd() {
  const plistDest = getPlistPath();
  const nodePath = process.execPath;
  const cliPath = join(PACKAGE_ROOT, 'bin', 'cli.js');
  const libDir = getLibDir();

  // Unload old plist if present
  if (existsSync(plistDest)) {
    try { execSync(`launchctl unload "${plistDest}" 2>/dev/null`); } catch {}
  }

  // Generate plist directly (cleaner than string replacement with 3-arg ProgramArguments)
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>Label</key>
\t<string>${PLIST_LABEL}</string>
\t<key>ProgramArguments</key>
\t<array>
\t\t<string>${nodePath}</string>
\t\t<string>${cliPath}</string>
\t\t<string>start</string>
\t</array>
\t<key>RunAtLoad</key>
\t<true/>
\t<key>KeepAlive</key>
\t<true/>
\t<key>StandardOutPath</key>
\t<string>${libDir}/server.log</string>
\t<key>StandardErrorPath</key>
\t<string>${libDir}/server.err</string>
\t<key>WorkingDirectory</key>
\t<string>${libDir}</string>
\t<key>EnvironmentVariables</key>
\t<dict>
\t\t<key>PATH</key>
\t\t<string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
\t</dict>
</dict>
</plist>
`;

  writeFileSync(plistDest, plist);

  try {
    execSync(`launchctl load "${plistDest}"`);
    console.log(`  launchd: loaded ${PLIST_LABEL}`);
  } catch {
    console.log(`  launchd: plist installed at ${plistDest}`);
    console.log(`  Run: launchctl load "${plistDest}"`);
  }
}

async function installSystemd() {
  const templatePath = join(PACKAGE_ROOT, 'config', 'systemd.service.template');
  const unitDir = join(homedir(), '.config', 'systemd', 'user');
  const unitPath = join(unitDir, SYSTEMD_UNIT);
  const nodePath = process.execPath;
  const cliPath = join(PACKAGE_ROOT, 'bin', 'cli.js');

  let template = readFileSync(templatePath, 'utf8');
  template = template
    .replace('__NODE_PATH__', nodePath)
    .replace('__CLI_PATH__', cliPath)
    .replace('__LIB_DIR__', getLibDir());

  mkdirSync(unitDir, { recursive: true });
  writeFileSync(unitPath, template);

  try {
    execSync('systemctl --user daemon-reload');
    execSync('systemctl --user enable --now mcp-librarian');
    console.log(`  systemd: enabled and started ${SYSTEMD_UNIT}`);
  } catch {
    console.log(`  systemd: unit installed at ${unitPath}`);
    console.log(`  Run: systemctl --user enable --now mcp-librarian`);
  }
}

export async function stopService() {
  const platform = detectPlatform();

  if (platform === 'darwin') {
    const plistPath = getPlistPath();
    if (existsSync(plistPath)) {
      try { execSync(`launchctl unload "${plistPath}"`); console.log('Service stopped (launchd)'); return; } catch {}
    }
  } else if (platform === 'linux') {
    try { execSync('systemctl --user stop mcp-librarian'); console.log('Service stopped (systemd)'); return; } catch {}
  }

  // Fallback: PID file
  const pidPath = getPidPath();
  if (existsSync(pidPath)) {
    const pid = parseInt(readFileSync(pidPath, 'utf8').trim(), 10);
    try { process.kill(pid, 'SIGTERM'); console.log(`Stopped PID ${pid}`); } catch {}
    try { unlinkSync(pidPath); } catch {}
    return;
  }

  console.log('No running service found');
}

export async function restartService() {
  await stopService();
  // Small delay for socket cleanup
  await new Promise(r => setTimeout(r, 500));
  const platform = detectPlatform();
  if (platform === 'darwin') {
    const plistPath = getPlistPath();
    if (existsSync(plistPath)) {
      try { execSync(`launchctl load "${plistPath}"`); console.log('Service restarted (launchd)'); return; } catch {}
    }
  } else if (platform === 'linux') {
    try { execSync('systemctl --user start mcp-librarian'); console.log('Service restarted (systemd)'); return; } catch {}
  }
  console.log('No service installed. Run: mcp-librarian start');
}

export async function showStatus() {
  const libDir = getLibDir();
  const socketPath = getSocketPath();
  const pidPath = getPidPath();

  console.log(`\n  \x1b[1mmcp-librarian status\x1b[0m\n`);
  console.log(`  Runtime dir:  ${libDir} ${existsSync(libDir) ? '\x1b[32m(exists)\x1b[0m' : '\x1b[31m(missing)\x1b[0m'}`);
  console.log(`  Socket:       ${socketPath} ${existsSync(socketPath) ? '\x1b[32m(active)\x1b[0m' : '\x1b[33m(not running)\x1b[0m'}`);

  if (existsSync(pidPath)) {
    const pid = readFileSync(pidPath, 'utf8').trim();
    console.log(`  PID:          ${pid}`);
  }

  // Check service
  const platform = detectPlatform();
  if (platform === 'darwin') {
    try {
      const out = execSync(`launchctl list ${PLIST_LABEL} 2>/dev/null`, { encoding: 'utf8' });
      console.log(`  launchd:      \x1b[32mloaded\x1b[0m`);
    } catch {
      console.log(`  launchd:      \x1b[33mnot loaded\x1b[0m`);
    }
  } else if (platform === 'linux') {
    try {
      const out = execSync('systemctl --user is-active mcp-librarian 2>/dev/null', { encoding: 'utf8' });
      console.log(`  systemd:      \x1b[32m${out.trim()}\x1b[0m`);
    } catch {
      console.log(`  systemd:      \x1b[33minactive\x1b[0m`);
    }
  }

  // Count skills
  const skillsDir = join(libDir, 'skills');
  if (existsSync(skillsDir)) {
    const count = readdirSync(skillsDir, { withFileTypes: true }).filter(e => e.isDirectory()).length;
    console.log(`  Skills:       ${count}`);
  }

  console.log('');
}
```

- [ ] **Step 4: Create `config/systemd.service.template`**

```ini
[Unit]
Description=MCP Librarian skills server
After=network.target

[Service]
Type=simple
ExecStart=__NODE_PATH__ __CLI_PATH__ start
WorkingDirectory=__LIB_DIR__
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
```

- [ ] **Step 5: Write `src/cli/setup-clients.js`**

Port the MCP client detection logic from `install.sh` into Node:

```js
/**
 * Auto-detect and configure MCP clients.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(__dirname, '..', '..');
const STDIO_PATH = join(PACKAGE_ROOT, 'bin', 'mcp-librarian-stdio.js');
const NODE_PATH = process.execPath;

export async function configureClients(flags) {
  const onlyClient = flags.only;

  if (!onlyClient || onlyClient === 'claude-code') {
    configureClaudeCode();
  }
  if (!onlyClient || onlyClient === 'cclocal') {
    configureCclocal();
  }
  if (!onlyClient || onlyClient === 'crush') {
    configureCrush();
  }
}

function configureClaudeCode() {
  try {
    // Check if claude CLI exists
    execSync('which claude', { encoding: 'utf8', stdio: 'pipe' });

    // Remove old entry, add fresh (idempotent)
    const env = { ...process.env };
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;

    try { execSync(`claude mcp remove --scope user librarian`, { env, stdio: 'pipe' }); } catch {}
    execSync(`claude mcp add --scope user librarian -- "${NODE_PATH}" "${STDIO_PATH}"`, { env, stdio: 'pipe' });
    console.log('  Claude Code: configured');
  } catch {
    console.log(`  Claude Code: 'claude' CLI not found, configure manually:`);
    console.log(`    claude mcp add --scope user librarian -- ${NODE_PATH} ${STDIO_PATH}`);
  }
}

function configureCclocal() {
  const ccDir = join(homedir(), '.claude-local');
  if (!existsSync(ccDir)) { console.log('  cclocal: not found, skipping'); return; }

  const configPath = join(ccDir, 'claude.json');
  let config = {};
  if (existsSync(configPath)) {
    try { config = JSON.parse(readFileSync(configPath, 'utf8')); } catch {}
  }

  if (!config.projects) config.projects = {};
  const homeKey = homedir();
  if (!config.projects[homeKey]) config.projects[homeKey] = {};
  if (!config.projects[homeKey].mcpServers) config.projects[homeKey].mcpServers = {};

  config.projects[homeKey].mcpServers.librarian = {
    type: 'stdio',
    command: NODE_PATH,
    args: [STDIO_PATH],
  };

  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  console.log('  cclocal: configured');
}

function configureCrush() {
  const crushConfig = join(homedir(), '.config', 'crush', 'config.json');
  if (!existsSync(crushConfig)) { console.log('  Crush: not found, skipping'); return; }

  let config;
  try { config = JSON.parse(readFileSync(crushConfig, 'utf8')); } catch { return; }
  if (!config.mcpServers) config.mcpServers = {};

  config.mcpServers.librarian = {
    command: NODE_PATH,
    args: [STDIO_PATH],
  };

  writeFileSync(crushConfig, JSON.stringify(config, null, 2) + '\n');
  console.log('  Crush: configured');
}
```

- [ ] **Step 6: Run tests**

Run: `node --test test/test-service.js`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/cli/service.js src/cli/setup-clients.js config/systemd.service.template test/test-service.js
git commit -m "feat: add service management (launchd/systemd) and MCP client auto-configuration"
```

---

## Task 6: Uninstall Command (`src/cli/uninstall.js`)

**Files:**
- Create: `src/cli/uninstall.js`

- [ ] **Step 1: Write `src/cli/uninstall.js`**

```js
/**
 * Clean removal of mcp-librarian runtime state, services, and client configs.
 */

import { existsSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { getLibDir } from './paths.js';
import { stopService, detectPlatform, getPlistPath } from './service.js';

export async function runUninstall(flags) {
  const libDir = getLibDir();

  if (!flags.yes) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise(resolve => {
      rl.question(`\nThis will remove ${libDir} and all services. Continue? [y/N] `, resolve);
    });
    rl.close();
    if (answer.toLowerCase() !== 'y') {
      console.log('Cancelled.');
      return;
    }
  }

  // Stop service
  console.log('Stopping service...');
  await stopService();

  // Remove service files
  const platform = detectPlatform();
  const plistPath = getPlistPath();
  if (existsSync(plistPath)) {
    rmSync(plistPath, { force: true });
    console.log(`  Removed: ${plistPath}`);
  }

  // Remove MCP client configs
  console.log('Removing MCP client configurations...');
  removeClientConfigs();

  // Remove runtime dir
  if (existsSync(libDir)) {
    rmSync(libDir, { recursive: true, force: true });
    console.log(`  Removed: ${libDir}`);
  }

  console.log('\nUninstall complete. Run `npm uninstall -g mcp-librarian` to remove the package.');
}

function removeClientConfigs() {
  // Claude Code
  try {
    const env = { ...process.env };
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;
    execSync('claude mcp remove --scope user librarian', { env, stdio: 'pipe' });
    console.log('  Claude Code: removed');
  } catch {
    console.log('  Claude Code: not configured or claude CLI not found');
  }

  // cclocal
  const ccPath = join(homedir(), '.claude-local', 'claude.json');
  if (existsSync(ccPath)) {
    try {
      const config = JSON.parse(readFileSync(ccPath, 'utf8'));
      for (const proj of Object.values(config.projects || {})) {
        if (proj.mcpServers?.librarian) delete proj.mcpServers.librarian;
      }
      writeFileSync(ccPath, JSON.stringify(config, null, 2) + '\n');
      console.log('  cclocal: removed');
    } catch {}
  }

  // Crush
  const crushPath = join(homedir(), '.config', 'crush', 'config.json');
  if (existsSync(crushPath)) {
    try {
      const config = JSON.parse(readFileSync(crushPath, 'utf8'));
      if (config.mcpServers?.librarian) delete config.mcpServers.librarian;
      writeFileSync(crushPath, JSON.stringify(config, null, 2) + '\n');
      console.log('  Crush: removed');
    } catch {}
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/cli/uninstall.js
git commit -m "feat: add uninstall command for clean removal"
```

---

## Task 7: Skill Pack Management (`src/cli/packs.js`)

**Files:**
- Create: `src/cli/packs.js`
- Test: `test/test-packs.js`

- [ ] **Step 1: Write failing tests**

```js
// test/test-packs.js
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('packs', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'mcp-packs-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('validates pack.json manifest', async () => {
    const { validatePackManifest } = await import('../src/cli/packs.js');
    const valid = { name: 'test-pack', description: 'Test', skills: ['skill-a'] };
    assert.equal(validatePackManifest(valid).valid, true);
  });

  it('rejects pack.json without name', async () => {
    const { validatePackManifest } = await import('../src/cli/packs.js');
    const invalid = { description: 'Test', skills: ['skill-a'] };
    assert.equal(validatePackManifest(invalid).valid, false);
  });

  it('copyPackSkills copies skills to packs dir', async () => {
    const { copyPackSkills } = await import('../src/cli/packs.js');
    const srcDir = join(tempDir, 'src', 'skills');
    const destDir = join(tempDir, 'packs', 'test-pack', 'skills');
    mkdirSync(join(srcDir, 'my-skill'), { recursive: true });
    writeFileSync(join(srcDir, 'my-skill', 'SKILL.md'), '---\nname: my-skill\ndescription: "test"\n---\n## X\nContent');
    await copyPackSkills(srcDir, destDir);
    assert.ok(existsSync(join(destDir, 'my-skill', 'SKILL.md')));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/test-packs.js`
Expected: FAIL — module not found

- [ ] **Step 3: Write `src/cli/packs.js`**

```js
/**
 * GitHub-based skill pack management.
 * install-pack, update-pack, list-packs, remove-pack, export-pack.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { getPacksDir, getSkillsDir, getLibDir } from './paths.js';
import { signAllSkills } from './setup.js';
import { guardContent } from '../librarian/content-guard.js';
import { parseSkill } from '../store/parser.js';
import { validateSkill } from '../librarian/validator.js';

export function validatePackManifest(manifest) {
  const issues = [];
  if (!manifest.name) issues.push('Missing required field: name');
  if (!manifest.description) issues.push('Missing required field: description');
  if (!manifest.skills || !Array.isArray(manifest.skills) || manifest.skills.length === 0) {
    issues.push('Missing or empty skills array');
  }
  return { valid: issues.length === 0, issues };
}

export async function copyPackSkills(srcSkillsDir, destSkillsDir) {
  mkdirSync(destSkillsDir, { recursive: true });
  const entries = readdirSync(srcSkillsDir, { withFileTypes: true });
  let count = 0;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const srcSkill = join(srcSkillsDir, entry.name, 'SKILL.md');
    if (!existsSync(srcSkill)) continue;

    const destDir = join(destSkillsDir, entry.name);
    mkdirSync(destDir, { recursive: true });
    cpSync(srcSkill, join(destDir, 'SKILL.md'));
    count++;
  }

  return count;
}

export async function installPack(repoRef) {
  // repoRef: "user/repo" or "user/repo#branch"
  const [repo, branch] = repoRef.split('#');
  const packsDir = getPacksDir();
  const packName = repo.split('/').pop();

  console.log(`\nInstalling pack: ${repo}...`);

  // Clone to temp
  const tempDir = mkdtempSync(join(tmpdir(), 'mcp-pack-'));
  try {
    const branchFlag = branch ? `--branch ${branch}` : '';
    execSync(`git clone --depth 1 ${branchFlag} https://github.com/${repo}.git "${tempDir}"`, { stdio: 'pipe' });

    // Validate pack.json
    const manifestPath = join(tempDir, 'pack.json');
    if (!existsSync(manifestPath)) {
      throw new Error('No pack.json found in repository');
    }

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const validation = validatePackManifest(manifest);
    if (!validation.valid) {
      throw new Error(`Invalid pack.json: ${validation.issues.join(', ')}`);
    }

    // Validate and guard each skill
    const srcSkills = join(tempDir, 'skills');
    if (!existsSync(srcSkills)) {
      throw new Error('No skills/ directory found in repository');
    }

    for (const entry of readdirSync(srcSkills, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skillPath = join(srcSkills, entry.name, 'SKILL.md');
      if (!existsSync(skillPath)) continue;
      const content = readFileSync(skillPath, 'utf8');

      // Validate structure
      const parsed = parseSkill(content, entry.name);
      parsed._raw = content;
      const validation = validateSkill(parsed);
      if (!validation.valid) {
        throw new Error(`Invalid skill ${entry.name}: ${validation.issues.map(i => i.message).join(', ')}`);
      }

      // Content guard — block prompt injection in prose
      const guardResult = guardContent(content);
      if (guardResult.blocked) {
        throw new Error(`Skill ${entry.name} blocked by content guard: ${guardResult.reason}`);
      }
    }

    const destDir = join(packsDir, packName);
    mkdirSync(destDir, { recursive: true });

    // Save pack.json
    cpSync(manifestPath, join(destDir, 'pack.json'));

    // Save repo reference for updates
    writeFileSync(join(destDir, '.source'), repoRef);

    // Copy skills
    const destSkills = join(destDir, 'skills');
    const count = await copyPackSkills(srcSkills, destSkills);

    // Re-sign manifest
    const libDir = getLibDir();
    await signAllSkills(libDir, getSkillsDir(), packsDir);

    console.log(`  Installed ${count} skills from ${packName}`);
    console.log('  Restart the server to pick up new skills: mcp-librarian restart');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

export async function updatePack(packName) {
  const packsDir = getPacksDir();
  const packDir = join(packsDir, packName);

  if (!existsSync(packDir)) {
    console.error(`Pack not found: ${packName}`);
    process.exit(1);
  }

  const sourcePath = join(packDir, '.source');
  if (!existsSync(sourcePath)) {
    console.error(`No source reference found for ${packName}. Reinstall with install-pack.`);
    process.exit(1);
  }

  const repoRef = readFileSync(sourcePath, 'utf8').trim();
  // Remove old pack and reinstall
  rmSync(packDir, { recursive: true, force: true });
  await installPack(repoRef);
}

export async function listPacks() {
  const packsDir = getPacksDir();

  if (!existsSync(packsDir)) {
    console.log('No packs installed.');
    return;
  }

  const entries = readdirSync(packsDir, { withFileTypes: true });
  const packs = entries.filter(e => e.isDirectory());

  if (packs.length === 0) {
    console.log('No packs installed.');
    return;
  }

  console.log(`\n  Installed packs:\n`);
  for (const pack of packs) {
    const manifestPath = join(packsDir, pack.name, 'pack.json');
    let desc = '';
    if (existsSync(manifestPath)) {
      try {
        const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
        desc = m.description || '';
      } catch {}
    }

    const skillsDir = join(packsDir, pack.name, 'skills');
    let skillCount = 0;
    if (existsSync(skillsDir)) {
      skillCount = readdirSync(skillsDir, { withFileTypes: true }).filter(e => e.isDirectory()).length;
    }

    console.log(`  \x1b[1m${pack.name}\x1b[0m (${skillCount} skills) — ${desc}`);
  }
  console.log('');
}

export async function removePack(packName) {
  const packsDir = getPacksDir();
  const packDir = join(packsDir, packName);

  if (!existsSync(packDir)) {
    console.error(`Pack not found: ${packName}`);
    process.exit(1);
  }

  rmSync(packDir, { recursive: true, force: true });

  // Re-sign manifest
  const libDir = getLibDir();
  await signAllSkills(libDir, getSkillsDir(), packsDir);

  console.log(`Removed pack: ${packName}`);
  console.log('Restart the server to update index: mcp-librarian restart');
}

export async function exportPack(outputDir) {
  const skillsDir = getSkillsDir();

  if (!existsSync(skillsDir)) {
    console.error('No skills found. Run `mcp-librarian setup` first.');
    process.exit(1);
  }

  mkdirSync(join(outputDir, 'skills'), { recursive: true });

  const entries = readdirSync(skillsDir, { withFileTypes: true });
  const skillNames = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const srcSkill = join(skillsDir, entry.name, 'SKILL.md');
    if (!existsSync(srcSkill)) continue;

    const destDir = join(outputDir, 'skills', entry.name);
    mkdirSync(destDir, { recursive: true });
    cpSync(srcSkill, join(destDir, 'SKILL.md'));
    skillNames.push(entry.name);
  }

  const manifest = {
    name: 'my-pack',
    description: 'Exported skill pack',
    author: 'penumbraforge',
    skills: skillNames,
  };

  writeFileSync(join(outputDir, 'pack.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Exported ${skillNames.length} skills to ${outputDir}`);
  console.log('Edit pack.json to customize name/description, then push to GitHub.');
}
```

- [ ] **Step 4: Run tests**

Run: `node --test test/test-packs.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/packs.js test/test-packs.js
git commit -m "feat: add skill pack management — install, update, list, remove, export"
```

---

## Task 8: Create-Skill Command (`src/cli/skills.js`)

**Files:**
- Create: `src/cli/skills.js`

- [ ] **Step 1: Write `src/cli/skills.js`**

```js
/**
 * Scaffold a new skill in ~/.mcp-librarian/skills/.
 */

import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getSkillsDir } from './paths.js';
import { SKILL_TEMPLATE } from '../librarian/validator.js';
import { sanitizeSkillName } from '../security/path-guard.js';

export async function createSkill(name) {
  const safeName = sanitizeSkillName(name);
  const skillsDir = getSkillsDir();
  const skillDir = join(skillsDir, safeName);

  if (existsSync(skillDir)) {
    console.error(`Skill already exists: ${safeName}`);
    console.error(`Edit: ${join(skillDir, 'SKILL.md')}`);
    process.exit(1);
  }

  mkdirSync(skillDir, { recursive: true });

  const content = SKILL_TEMPLATE
    .replace('{{NAME}}', safeName)
    .replace('{{DESCRIPTION}}', `${safeName} reference`)
    .replace('{{DOMAIN}}', 'general');

  writeFileSync(join(skillDir, 'SKILL.md'), content);
  console.log(`Created: ${join(skillDir, 'SKILL.md')}`);
  console.log('Edit the file, then restart the server to pick it up.');
}
```

- [ ] **Step 2: Commit**

```bash
git add src/cli/skills.js
git commit -m "feat: add create-skill scaffolding command"
```

---

## Task 9: Update `package.json` and `README.md`

**Files:**
- Modify: `package.json`
- Modify: `README.md`

- [ ] **Step 1: Update `package.json`**

```json
{
  "name": "mcp-librarian",
  "version": "3.0.0",
  "description": "Intelligent MCP skills server — BM25 search, progressive disclosure, Ed25519 integrity",
  "type": "module",
  "engines": {
    "node": ">=22.0.0"
  },
  "bin": {
    "mcp-librarian": "./bin/cli.js",
    "mcp-librarian-stdio": "./bin/mcp-librarian-stdio.js"
  },
  "files": [
    "bin/",
    "config/",
    "src/",
    "skills/",
    "LICENSE",
    "README.md"
  ],
  "scripts": {
    "start": "node bin/cli.js start",
    "test": "node --test test/test-*.js",
    "setup": "node bin/cli.js setup"
  },
  "keywords": ["mcp", "skills", "librarian", "bm25", "security", "ed25519", "claude"],
  "author": "Penumbra Forge <hello@penumbraforge.com> (https://penumbraforge.com)",
  "license": "MIT",
  "homepage": "https://penumbraforge.com/librarian",
  "repository": {
    "type": "git",
    "url": "https://github.com/penumbraforge/mcp-librarian.git"
  },
  "dependencies": {}
}
```

- [ ] **Step 2: Rewrite `README.md`**

Full rewrite focusing on npm-first installation. Keep the technical depth but lead with the easy path. See existing README for section structure — preserve: How It Works, Tools, Security, Architecture, Testing sections. Change: Quick Start, Uninstall, Requirements.

Key changes:
- Quick Start: `npm install -g mcp-librarian && mcp-librarian setup`
- Add Skill Packs section
- Add CLI Reference section
- Update version references to 3.0.0
- Update repo URL to penumbraforge org

- [ ] **Step 3: Commit**

```bash
git add package.json README.md
git commit -m "feat: update package.json for npm publishing, rewrite README for npm-first install"
```

---

## Task 10: Remove Old Skills, Add New Starter Skills

**Files:**
- Delete: `skills/redteam/`
- Delete: `skills/unbias/`
- Create: `skills/git/SKILL.md`
- Create: `skills/docker/SKILL.md`
- Create: `skills/sql/SKILL.md`
- Create: `skills/api-design/SKILL.md`
- Create: `skills/testing/SKILL.md`
- Create: `skills/debugging/SKILL.md`
- Create: `skills/security/SKILL.md`

Each skill should follow the existing format:
- YAML frontmatter: name, description (max 200 chars), domain, version "1.0"
- `##` top-level sections, `###` sub-sections for BM25 chunking
- Target 20-60 KB per skill
- Include practical code examples in fenced blocks
- Focus on patterns and recipes, not reference docs

- [ ] **Step 1: Delete old skills**

```bash
rm -rf skills/redteam skills/unbias
```

- [ ] **Step 2: Create `skills/git/SKILL.md`**

Content: Git workflows (trunk-based, GitFlow), rebasing vs merge, interactive rebase, conflict resolution strategies, hooks (pre-commit, pre-push), monorepo patterns (sparse checkout, git subtree), bisect, reflog recovery, `.gitattributes`, LFS, signing commits.

- [ ] **Step 3: Create `skills/docker/SKILL.md`**

Content: Dockerfile best practices (multi-stage builds, layer caching, scratch/distroless base), docker compose patterns, networking, volumes, health checks, debugging containers (exec, logs, inspect), security scanning, registry patterns, buildkit features.

- [ ] **Step 4: Create `skills/sql/SKILL.md`**

Content: Query optimization (EXPLAIN, indexes), JOIN strategies, window functions, CTEs, transactions & isolation levels, migration patterns, PostgreSQL-specific (JSONB, arrays, extensions), MySQL gotchas, SQLite for local dev, connection pooling, N+1 problem, bulk operations.

- [ ] **Step 5: Create `skills/api-design/SKILL.md`**

Content: REST conventions (resource naming, HTTP methods, status codes), error response format, pagination (cursor vs offset), filtering/sorting, versioning strategies, authentication patterns (JWT, OAuth2, API keys), rate limiting, HATEOAS, OpenAPI spec, GraphQL comparison.

- [ ] **Step 6: Create `skills/testing/SKILL.md`**

Content: Testing pyramid, unit vs integration vs e2e, mocking strategies by language (Jest, pytest, Go testing), test doubles (mocks, stubs, fakes, spies), property-based testing, snapshot testing, CI integration, coverage thresholds, flaky test debugging, test data factories.

- [ ] **Step 7: Create `skills/debugging/SKILL.md`**

Content: Systematic debugging methodology (reproduce, isolate, identify, fix, verify), profiling (CPU, memory, I/O), Node.js debugging (--inspect, heap snapshots), Python (pdb, cProfile), browser DevTools, logging strategies, distributed tracing, memory leaks, deadlocks, race conditions.

- [ ] **Step 8: Create `skills/security/SKILL.md`**

Content: OWASP Top 10 with defensive code examples (not offensive), XSS prevention (CSP, sanitization, encoding), SQL injection (parameterized queries), CSRF tokens, auth best practices, secrets management, CORS configuration, dependency scanning, HTTPS/TLS, input validation patterns.

- [ ] **Step 9: Re-sign manifest with new skill set**

```bash
node --test test/test-*.js  # Verify tests still pass
```

- [ ] **Step 10: Commit**

```bash
git add skills/
git commit -m "feat: replace redteam/unbias with 7 new daily-use skills (git, docker, sql, api-design, testing, debugging, security)"
```

---

## Task 11: Update Existing Tests & Add CLI Tests

Verify that existing tests pass with the multi-directory SkillStore changes, and that all new CLI code is tested.

**Files:**
- Modify: existing tests if needed for SkillStore constructor change
- Verify: `test/test-*.js` all pass

- [ ] **Step 1: Run full test suite**

Run: `node --test test/test-*.js`
Expected: All PASS. If any fail due to SkillStore constructor signature change, update them to pass a string (backward compat via Array.isArray check).

- [ ] **Step 2: Run new CLI tests**

Run: `node --test test/test-cli.js test/test-setup.js test/test-service.js test/test-packs.js`
Expected: All PASS

- [ ] **Step 3: Commit any test fixes**

```bash
git add test/
git commit -m "test: update tests for multi-directory SkillStore and add CLI test coverage"
```

---

## Task 12: Final Integration Test & npm Publish Dry Run

End-to-end verification that the package works as expected.

- [ ] **Step 1: Run full test suite**

Run: `node --test test/test-*.js`
Expected: All PASS

- [ ] **Step 2: Verify npm package contents**

Run: `npm pack --dry-run`
Expected: Lists all files that would be in the tarball. Verify:
- `bin/cli.js` present
- `bin/mcp-librarian.js` present
- `bin/mcp-librarian-stdio.js` present
- `src/cli/` present
- `skills/` present (10 skill dirs, no redteam, no unbias)
- `config/` present (default.json, systemd template, plist)
- No `test/`, `docs/`, `staging/`, `install.sh`, `uninstall.sh`

- [ ] **Step 3: Verify CLI help works**

Run: `node bin/cli.js help`
Expected: Prints help text with all commands

Run: `node bin/cli.js version`
Expected: Prints `mcp-librarian v3.0.0`

- [ ] **Step 4: Test setup in isolated environment**

Run in a temp dir:
```bash
export HOME=$(mktemp -d)
node /path/to/mcp-librarian/bin/cli.js setup --skip-clients --skip-service
ls -la $HOME/.mcp-librarian/
ls $HOME/.mcp-librarian/skills/
```
Expected: Runtime dir created, keys generated, 10 skills copied, manifest signed.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "chore: finalize v3.0.0 npm launch"
```

- [ ] **Step 6: Tag release**

```bash
git tag v3.0.0
```

Do NOT push or publish — wait for user confirmation.
