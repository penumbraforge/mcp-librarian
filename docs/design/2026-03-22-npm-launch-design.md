# mcp-librarian npm Launch Design

**Date:** 2026-03-22
**Author:** penumbraforge
**Status:** Approved

## Problem

mcp-librarian has a polished core (BM25 search, Ed25519 signing, hash-chained audit, context-aware content guard) but the installation story blocks adoption. It requires git clone, a bash script, and macOS-specific launchd setup. There's no npm package, no Linux auto-start, and the bundled skills are niche rather than broadly useful.

## Goals

1. Anyone on macOS or Linux can install with `npm install -g mcp-librarian`
2. `mcp-librarian setup` configures everything — keys, skills, MCP clients, service — with zero prompts
3. Bundled starter pack of 10 skills covers what developers actually use daily
4. Community skill packs installable from GitHub repos
5. Users can create and export their own skills

## Non-Goals

- Windows native support (recommend WSL, revisit later)
- Central skill registry (GitHub-based for now, penumbraforge.com registry is future work)
- Changes to server internals (socket, framing, auth, BM25, security layers stay as-is)
- Clawlet migration (legacy path from v1, dropped)
- `$XDG_DATA_HOME` on macOS (XDG respected on Linux only)

## Distribution

- **npm package name:** `mcp-librarian` (unscoped, confirmed available)
- **Primary install:** `npm install -g mcp-librarian`
- **Also works:** `npx mcp-librarian setup` (one-shot setup without global install)
- **Platforms:** macOS, Linux. Docs state "Windows via WSL."
- **Git clone** remains as the contributor/development path
- **Sole contributor:** penumbraforge

## CLI Commands

### Core

```
mcp-librarian setup              # keygen, sign skills, detect & configure clients, install service
mcp-librarian start              # run server (foreground)
mcp-librarian stop               # stop running service (launchd/systemd) or foreground PID
mcp-librarian restart             # stop + start the service
mcp-librarian status             # show server health, service status
mcp-librarian uninstall          # remove keys, secrets, service, client configs (with confirmation)
mcp-librarian uninstall --yes    # skip confirmation
```

### Setup Flags

```
mcp-librarian setup --dry-run       # preview what would happen, change nothing
mcp-librarian setup --skip-clients  # skip MCP client auto-configuration
mcp-librarian setup --skip-service  # skip launchd/systemd service installation
mcp-librarian setup --only <client> # configure only a specific client (e.g., claude-code)
mcp-librarian setup --force-keygen  # regenerate keys even if they exist
```

### Skill Management

```
mcp-librarian install-pack <github-user/repo>   # install skill pack from GitHub
mcp-librarian update-pack <pack-name>            # re-fetch and update an installed pack
mcp-librarian list-packs                         # list installed packs and their skills
mcp-librarian remove-pack <pack-name>            # remove an installed pack
mcp-librarian create-skill <name>                # scaffold a new skill in ~/.mcp-librarian/skills/
mcp-librarian export-pack <dir>                  # bundle skills into a shareable pack
```

## Runtime Directory Layout

When installed via npm global, the package root (e.g., `/usr/local/lib/node_modules/mcp-librarian/`) is **read-only**. All writable state lives under `~/.mcp-librarian/` (or `$XDG_DATA_HOME/mcp-librarian/` on Linux if set).

```
~/.mcp-librarian/
  ed25519.pub              # signing public key
  ed25519.priv             # signing private key (0o600)
  client.secret            # HMAC key for client auth (0o600)
  librarian.secret         # HMAC key for librarian auth (0o600)
  audit.secret             # HMAC key for audit log (0o600)
  librarian.sock           # Unix domain socket
  audit.jsonl              # hash-chained audit log
  manifest.json            # Ed25519 signed manifest for all skills
  skills/                  # all active skills (bundled + user-created)
    automation/SKILL.md
    frontend/SKILL.md
    scripting/SKILL.md
    git/SKILL.md
    ...
  packs/                   # installed skill packs (each pack gets a subdirectory)
    <pack-name>/
      pack.json
      skills/
        <skill>/SKILL.md
  staging/                 # draft skills awaiting promotion
```

**Key design decision:** During `setup`, bundled skills are **copied** from the npm package root into `~/.mcp-librarian/skills/`. The server resolves `SKILLS_DIR` and `STAGING_DIR` from `~/.mcp-librarian/`, never from the package root. This makes npm global installs, git-clone installs, and npx all behave identically at runtime.

**Multi-directory skill loading:** The server scans skills from two locations:
1. `~/.mcp-librarian/skills/` — bundled + user-created skills
2. `~/.mcp-librarian/packs/*/skills/` — installed pack skills

All skills from both locations are indexed into a single BM25 index and signed in a single manifest.

## Setup Flow

`mcp-librarian setup` runs fully automatically with no prompts. Flags control behavior.

1. **Create runtime directory** — `~/.mcp-librarian/` with `0o700` permissions. On Linux, respect `$XDG_DATA_HOME` if set.
2. **Generate cryptographic material** — Ed25519 keypair + 3 HMAC secrets (client, librarian, audit), 256-bit each. All secrets get `0o600` permissions. Skips if keys already exist (unless `--force-keygen`).
3. **Copy bundled skills** — copy skills from npm package root to `~/.mcp-librarian/skills/`. Existing user-modified skills are preserved (only overwrites if bundled version is newer by package version).
4. **Sign all skills** — SHA-256 hash + Ed25519 signature for every skill in `~/.mcp-librarian/skills/` and `~/.mcp-librarian/packs/*/skills/`, written to `~/.mcp-librarian/manifest.json`.
5. **Detect and clean old installations** — if a launchd plist or systemd unit from a previous install (git-clone or older npm version) exists, unload/stop it before installing the new one. Prevents socket conflicts.
6. **Auto-detect platform, install service:**
   - **macOS:** Install launchd plist to `~/Library/LaunchAgents/com.mcp-librarian.server.plist`, then `launchctl load` it.
   - **Linux:** Install systemd user unit to `~/.config/systemd/user/mcp-librarian.service`, run `systemctl --user daemon-reload && systemctl --user enable --now mcp-librarian`.
7. **Auto-detect MCP clients, configure each found:**
   - **Claude Code:** via `claude mcp add` CLI (remove old entry first for idempotency)
   - **cclocal:** direct JSON edit to `~/.claude-local/claude.json`
   - **Crush:** direct JSON edit to `~/.config/crush/config.json`
   - Extensible pattern for future clients
8. **Print summary** — list everything that was configured, any warnings, and next steps.

### Service Management Details

**`mcp-librarian start`** — starts the server in the foreground. Checks for a running service first; if one is bound to the socket, prints a warning and exits (use `restart` or `stop` first).

**`mcp-librarian stop`:**
- **macOS:** `launchctl unload` the plist
- **Linux:** `systemctl --user stop mcp-librarian`
- **Fallback:** if no service manager entry found, reads PID from `~/.mcp-librarian/librarian.pid` and sends SIGTERM

**`mcp-librarian restart`:** `stop` then starts via the service manager (or foreground if no service installed).

The server writes a PID file to `~/.mcp-librarian/librarian.pid` on startup, removed on clean shutdown.

### systemd Unit Template

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

`__NODE_PATH__`, `__CLI_PATH__`, and `__LIB_DIR__` are replaced during setup with resolved absolute paths.

### Idempotency

Running `mcp-librarian setup` multiple times is safe. It detects existing keys/config and skips or updates as needed. Never destroys existing keys unless `--force-keygen` is passed.

### npm Lifecycle

- `npm install -g` places binaries on PATH. No postinstall side effects.
- `npm update -g mcp-librarian` updates binaries. User should re-run `mcp-librarian setup` to pick up new bundled skills (prints a reminder if bundled skill versions are newer than installed).
- `npm uninstall -g mcp-librarian` only removes the package. Docs advise running `mcp-librarian uninstall` first to clean up runtime state and services.

## Starter Pack

10 bundled skills covering daily developer needs:

| Skill | Domain | Status |
|-------|--------|--------|
| automation | automation | existing (keep) |
| frontend | frontend | existing (keep) |
| scripting | scripting | existing (keep) |
| git | devops | new |
| docker | devops | new |
| sql | general | new |
| api-design | general | new |
| testing | general | new |
| debugging | general | new |
| security | security | new (OWASP with defensive fixes, replaces redteam) |

**Removed from bundle:** `redteam` (offense-only, niche), `unbias` (niche)

Each skill follows the existing format: YAML frontmatter + `##` sections + `###` sub-sections for BM25 chunking. Target size: 20-60 KB per skill for good chunk coverage.

## Skill Packs (GitHub-Based)

### Pack Format

A skill pack is a GitHub repo containing:

```
pack.json             # manifest: name, description, author, skills list
skills/
  skill-name/
    SKILL.md          # standard skill format
  another-skill/
    SKILL.md
```

### Install Flow

`mcp-librarian install-pack penumbraforge/devops-pack`:

1. Clone repo to temp directory (shallow clone, depth=1)
2. Validate `pack.json` manifest
3. Validate each skill (frontmatter, structure, size limits)
4. Run content guard on each skill
5. Copy validated skills to `~/.mcp-librarian/packs/<pack-name>/skills/`
6. Sign new skills into manifest
7. Rebuild BM25 index
8. Clean up temp directory
9. Print summary of installed skills

### User-Created Skills

- `mcp-librarian create-skill my-topic` scaffolds `~/.mcp-librarian/skills/my-topic/SKILL.md` from template
- Users edit the skill, then it's picked up on next server restart or maintenance cycle
- `mcp-librarian export-pack ./my-pack` bundles skills from `~/.mcp-librarian/skills/` into a directory with `pack.json`, ready to push to GitHub

## npm Package Structure

```
package.json              # bin entries, files field, engines >=22, type: module
bin/
  cli.js                  # unified CLI entry point (setup, start, stop, status, etc.)
  mcp-librarian.js        # server bootstrap (now internal, started by cli.js)
  mcp-librarian-stdio.js  # MCP client stdio proxy (unchanged)
config/
  default.json            # server configuration defaults
  systemd.service.template # systemd user unit template
src/
  cli/                    # CLI subcommand handlers (new)
    setup.js              # keygen, signing, client detection, service install
    service.js            # launchd/systemd management
    packs.js              # install-pack, update-pack, list-packs, remove-pack
    skills.js             # create-skill
    uninstall.js          # clean removal
  server/                 # socket server, auth, framing, protocol (unchanged)
  store/                  # BM25, parser, cache, skill store (unchanged)
  security/               # Ed25519, HMAC, path guard, audit (unchanged)
  librarian/              # orchestrator, content guard, staging (unchanged)
  tools/                  # MCP tool definitions (unchanged)
skills/                   # 10 bundled skills (read-only source, copied to ~/.mcp-librarian/ during setup)
```

### package.json Changes

```json
{
  "name": "mcp-librarian",
  "version": "3.0.0",
  "description": "Intelligent MCP skills server — BM25 search, progressive disclosure, Ed25519 integrity",
  "type": "module",
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
  "engines": {
    "node": ">=22.0.0"
  },
  "author": "Penumbra Forge <hello@penumbraforge.com> (https://penumbraforge.com)",
  "license": "MIT"
}
```

No `postinstall` script. Setup is explicit via `mcp-librarian setup`.

**Excluded from npm tarball** (implicit via `files` whitelist): `test/`, `docs/`, `.git/`, `staging/`, `bin/install.sh`, `bin/uninstall.sh`.

## Code Changes Summary

### New

- `bin/cli.js` — unified CLI entry point with subcommand routing
- `src/cli/setup.js` — setup logic (replaces install.sh, ported to Node)
- `src/cli/service.js` — launchd + systemd service management
- `src/cli/packs.js` — GitHub pack install, update, list, remove
- `src/cli/skills.js` — skill scaffolding
- `src/cli/uninstall.js` — clean removal of runtime state and services
- `config/systemd.service.template` — systemd user unit
- 7 new skills (git, docker, sql, api-design, testing, debugging, security)

### Modified

- `package.json` — name, version, bin, files, type field
- `README.md` — rewrite install instructions for npm-first
- `bin/mcp-librarian.js` — resolve `SKILLS_DIR`, `STAGING_DIR` from `~/.mcp-librarian/` instead of `__dirname`. Write PID file on startup. (Internals unchanged.)
- `bin/mcp-librarian-stdio.js` — resolve `~/.mcp-librarian` path using shared utility instead of hardcode
- `src/store/skill-store.js` — load skills from multiple directories (bundled + packs)

### Removed

- `skills/redteam/` — removed from bundle (available as separate pack later)
- `skills/unbias/` — removed from bundle (available as separate pack later)
- `bin/install.sh` — kept in repo for git-clone contributors, excluded from npm tarball
- `bin/uninstall.sh` — kept in repo for git-clone contributors, excluded from npm tarball

### Unchanged

- All `src/server/` internals (socket, auth, framing, protocol)
- All `src/store/` internals except skill-store directory resolution
- All `src/security/` code
- All `src/librarian/` code
- All `src/tools/` code
- All existing test files (add new tests for CLI)

### Data Format Compatibility

No changes to: manifest format, BM25 index structure, audit log format, key formats, or MCP protocol version. Existing `~/.mcp-librarian/` state from v2.x is fully compatible.

## Testing

- Existing 89 tests remain unchanged
- New tests for:
  - CLI subcommand parsing
  - Setup flow (mock filesystem)
  - Service detection (platform sniffing)
  - Client detection (mock configs)
  - Pack install flow (mock git clone)
  - Skill scaffolding

## Migration

Users upgrading from git-clone v2.x:

- Existing `~/.mcp-librarian/` keys and config are preserved
- `mcp-librarian setup` detects existing keys and skips keygen
- Bundled skills are copied to `~/.mcp-librarian/skills/`, preserving user modifications to existing skills (only overwrites if bundled version is newer)
- Old launchd plist pointing at git-clone path is detected and replaced
- `redteam` and `unbias` skills remain in user's `~/.mcp-librarian/skills/` if present — not deleted, just no longer bundled
- Old `install.sh` and `uninstall.sh` kept in repo for git-clone contributors

## Version Note

Current `package.json` says `2.0.0`. Recent commit messages reference "v2.1" features (BM25 chunking, stemming, security hardening). This launch publishes as `3.0.0` to reflect the distribution and CLI overhaul. The v2.x line was never published to npm.
