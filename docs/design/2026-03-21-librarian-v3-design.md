# mcp-librarian v3.0.0 — Design Spec

**Date:** 2026-03-21
**Author:** Shadoe Myers + Claude
**Status:** Approved

---

## Overview

Clean room rewrite of mcp-librarian as a zero-dependency MCP skills server. Stdio transport, BM25 search with stemming and sub-section chunking, Ed25519 integrity, progressive disclosure. Ships with no built-in skills — community skill packs live in a separate repo and are installable via MCP tool call.

### Goals

1. **MCP 2025 compliant** — Tools, resources, prompts, logging APIs.
2. **Zero friction install** — `node bin/install.js` auto-detects MCP clients and configures them.
3. **Zero dependencies** — Only `node:` built-ins. No supply chain risk.
4. **Skill packs as ecosystem** — Server is the engine, skills are community content.
5. **Usable by anyone** — Not just the author. Clear docs, clean errors, works on macOS and Linux.

### Non-Goals

- No GUI, no web dashboard.
- No Ollama/LLM integration (replaced by `validate_skill` tool).
- No HMAC authentication (unnecessary with stdio transport).
- No Unix socket server (stdio only).
- No Windows native support (WSL works).
- No built-in skills shipped with the server.

---

## Architecture

```
MCP Client (Claude Code, Cursor, Windsurf, etc.)
  ↕ stdio (NDJSON, JSON-RPC 2.0)
  ↕
mcp-librarian process
  ├── Transport (stdio reader/writer)
  ├── Protocol (MCP 2025 dispatcher)
  │   ├── tools/*      — find, load, list, validate, install_pack, server_status
  │   ├── resources/*  — skill:// URIs for browsing
  │   ├── prompts/*    — write_skill, improve_skill templates
  │   └── logging/*    — structured logs via MCP notifications
  ├── Store
  │   ├── SkillStore   — loads, indexes, caches, deduplicates skills
  │   ├── BM25 Index   — full-text search with stemming + sub-section chunking
  │   └── LRU Cache    — recently accessed skills (configurable size/TTL)
  ├── Security
  │   ├── Ed25519      — sign/verify skill integrity
  │   ├── ContentGuard — prompt injection detection (2026 patterns)
  │   └── PathGuard    — directory traversal + symlink prevention
  └── Config
      └── env > config file > defaults (validated at startup)
```

**Transport:** Stdio only. The server reads NDJSON from stdin and writes NDJSON to stdout. One server process per MCP client session. No daemon, no socket, no bridge process. On stdin EOF or SIGTERM, the server exits cleanly with code 0. No cleanup needed — all writes are atomic (tmp + rename).

**Protocol:** MCP spec version `2025-03-26` (or latest stable). JSON-RPC 2.0. Supports `initialize`, `ping`, `tools/list`, `tools/call`, `resources/list`, `resources/read`, `prompts/list`, `prompts/get`, `logging/setLevel`.

**All I/O is async.** No `readFileSync` or `writeFileSync` anywhere. Uses `fs/promises` throughout.

---

## MCP Surface

### Tools

| Tool | Description |
|------|------------|
| `find_skill` | BM25 search across all skills. Returns ranked chunks with relevance scores. Input: `query` (string), optional `limit` (number, default 10). |
| `load_section` | Load a specific section by skill name + heading path. Input: `skill` (string), `section` (string). Progressive disclosure — load what you need, not the whole file. |
| `load_skill` | Load an entire skill file. Input: `skill` (string). For when the full document is needed. |
| `list_skills` | List all installed skills with metadata: name, version, categories, description, integrity status (VERIFIED/TAMPERED/UNSIGNED). No input. |
| `skill_status` | Check a specific skill's integrity details. Input: `skill` (string). Returns signature status, hash, last verified time. |
| `validate_skill` | Validate a skill file for: valid frontmatter (name, version, category, description), section structure (## and ### headings), content guard compliance. Input: `content` (string). Returns structured feedback — no LLM needed. Validates structure and content guard only — does NOT check for name collisions against installed skills (that's the dedup layer's job during install). |
| `install_pack` | Download and install a skill pack from the community repo. Input: `pack` (string — pack name). Fetches from GitHub, runs content guard, deduplicates, writes to skills directory, re-signs manifest, rebuilds index. |
| `server_status` | Server info: version, skill count, index stats (chunk count, unique terms), uptime, config summary. No input. |

### Resources

Skills are exposed as browsable MCP resources:

- **List:** `resources/list` returns all skills as `skill://{name}` URIs with metadata.
- **Read:** `resources/read` with URI `skill://{name}` returns the full skill content.
- **Sub-resources:** `skill://{name}/{section-slug}` returns a specific section.

This lets clients with resource browsers (e.g., Cursor) display the skill library without needing tool calls.

### Prompts

| Prompt | Description | Arguments |
|--------|------------|-----------|
| `write_skill` | Template with correct frontmatter format, section structure guidelines, and content guard rules. Helps users write well-formed skills. | `topic` (string) — what the skill should cover |
| `improve_skill` | Template that takes existing skill content and produces structured feedback on completeness, structure, and content guard compliance. | `content` (string) — the skill to review |

### Logging

Structured server logs via MCP `notifications/message`:
- Levels: `debug`, `info`, `warning`, `error`
- Client can set level via `logging/setLevel`
- Default level controlled by `MCP_LIBRARIAN_LOG_LEVEL` env var (default: `info`)

Log events include: skill loaded, search performed, pack installed, content guard violation, signature verification result, config loaded.

---

## Skill Format

```markdown
---
name: Skill Name
version: 1.0.0
category: [category1, category2]
description: One-line description used in search results and listings
---

## Section Heading

Content indexed by BM25 at the section level.

### Sub-Section Heading

Content chunked at ### boundaries for finer-grained search retrieval.
```

**BM25 chunking rules:**
- Each `##` section with no `###` children is one chunk.
- If a `##` section contains `###` sub-sections, each sub-section is a separate chunk instead (the `##` intro text before the first `###` is also a chunk).
- Chunks include their heading text (improves search relevance).
- `find_skill` returns: `[{ skill, section, score, snippet }]` where `section` is a `/`-separated slug path (e.g., `"setup/installation"`).

**Section path format:**
- Used in `load_section` tool and `skill://` resource URIs.
- `/`-separated path of heading slugs: lowercase, hyphens for spaces (e.g., `"getting-started/quick-setup"`).
- Example: `load_section({ skill: "react", section: "hooks/use-effect" })`.

**Frontmatter fields:**
- `name` (required, string) — unique identifier
- `version` (required, string — semver)
- `category` (required, array of strings)
- `description` (required, string — one line)

**Skills directory:** `~/.mcp-librarian/skills/` (configurable via `MCP_LIBRARIAN_HOME`).

Drop `.md` files in the directory. The server indexes them at startup and can rebuild the index on demand.

---

## Skill Packs

### Community Repo (`penumbraforge/mcp-librarian-skills`)

```
mcp-librarian-skills/
├── README.md                ← Pack listing, install instructions, contribution guide
├── CONTRIBUTING.md          ← How to submit a skill pack
├── .github/workflows/
│   └── validate-pr.yml     ← Auto-validate PRs (frontmatter, structure, content guard)
└── packs/
    ├── security/
    │   ├── pack.json        ← { "name": "security", "version": "1.0.0", "description": "...", "skills": ["redteam.md", "appsec.md"] }
    │   ├── redteam.md
    │   └── appsec.md
    ├── web-development/
    │   ├── pack.json
    │   ├── react.md
    │   ├── css.md
    │   └── accessibility.md
    └── ...
```

### install_pack Flow

1. User calls `install_pack` with pack name (e.g., `"security"`)
2. Server fetches `packs/security/pack.json` from GitHub raw content API
3. Reads the `skills` array from pack.json
4. For each skill file:
   a. Fetches the raw `.md` content from GitHub
   b. Runs content guard — rejects the file if injection patterns detected in prose
   c. Computes SHA-256 hash, checks for duplicates against existing skills
   d. If skill with same `name` exists: compares content. If different, replaces (update). If identical, skips.
   e. Writes to skills directory
5. Re-signs the manifest with Ed25519
6. Rebuilds BM25 index
7. Returns summary: installed N skills, updated M, skipped K (duplicates)

### GitHub Fetch Details

Uses `node:https` (no dependencies). URL template:
```
https://raw.githubusercontent.com/{repo}/main/packs/{pack}/pack.json
https://raw.githubusercontent.com/{repo}/main/packs/{pack}/{skill-file}
```

- Target ref: `main` branch (always latest)
- Timeout: 10 seconds per request
- On network failure or timeout: abort the pack install, report error, do not write partial results
- GitHub rate limit (unauthenticated): 60 requests/hour. If rate limited, return error with retry guidance.
- Optional: `GITHUB_TOKEN` env var. If set, sent as `Authorization: token {value}` header for authenticated requests (5,000/hour limit). Not required for public repos.

### Community Contributions

Contributors fork the repo, add their pack in `packs/{name}/`, open a PR. A GitHub Action on the skills repo automatically validates:
- Valid frontmatter (name, version, category, description present)
- Valid section structure (## and ### headings)
- Content guard passes (no prompt injection in prose)
- No duplicate skill names against existing packs
- pack.json is valid (name, version, description, skills array)

Maintainer (Shadoe) reviews and merges. Pack is immediately available via `install_pack`.

---

## Security Model

### Ed25519 Skill Signing

- Keypair generated at install time (`~/.mcp-librarian/keys/`)
- Private key: `0o600` permissions, never leaves the machine
- Signing is an internal function called by `install_pack` and by `bin/mcp-librarian.js sign` CLI subcommand (for manually added skills). Computes SHA-256 of each skill, signs hash + timestamp with private key, writes `manifest.json` atomically (tmp → rename).
- On every skill load: verify signature against public key
- Integrity status is cached from the last manifest verification (at startup and after `install_pack`). `list_skills` reads cached status, not recomputed per call. `skill_status` also reads cache but includes full details.
- Status reported: `VERIFIED` (signature valid), `TAMPERED` (hash mismatch), `UNSIGNED` (no signature in manifest)
- Unsigned skills are served but flagged — allows quick drafts without friction

**manifest.json schema:**

```json
{
  "version": 1,
  "signedAt": "2026-03-21T08:00:00.000Z",
  "skills": {
    "redteam": {
      "hash": "a1b2c3d4...",
      "signature": "base64-encoded-ed25519-signature",
      "signedAt": "2026-03-21T08:00:00.000Z"
    }
  }
}
```

- `hash`: SHA-256 hex digest of skill file content
- `signature`: Ed25519 signature of the string `{hash}|{signedAt}`, base64 encoded
- `signedAt`: ISO-8601 timestamp of when the skill was signed
- Signed payload is the literal string `"{hash}|{signedAt}"` — simple, deterministic, no JSON serialization ambiguity

### Content Guard (2026 Patterns)

Scans skill content for prompt injection. Context-aware: blocks patterns in prose, allows them in code blocks (security skills need real payloads).

**Blocked in prose:**
- ChatML tokens (`<|im_start|>`, `<|system|>`, `<|end|>`, etc.)
- Llama/Mistral control tokens (`[INST]`, `<<SYS>>`, `[/INST]`)
- Instruction overrides (`IGNORE.*INSTRUCTIONS`, `DISREGARD.*ABOVE`)
- Role impersonation (`YOU ARE NOW`, `ACT AS`, `PRETEND TO BE`)
- Data exfiltration (`REVEAL.*PROMPT`, `SHOW.*SYSTEM`)
- XML tag injection (`<operations>`, `<instructions>`, `<system>`, `<override>`)
- Unicode tricks: null bytes, RTL override (`\u202E`), zero-width chars (`\u200B`, `\u200C`, `\u200D`, `\uFEFF`)
- Variation selectors (`\uFE0E`, `\uFE0F`), soft hyphens (`\u00AD`)
- Large base64 payloads (>5000 chars in non-code context)

**Allowed in code blocks:**
All of the above. Code blocks are fenced (``` or indented 4 spaces). A security skill teaching about XSS needs `<script>` tags. A pentesting skill needs real payloads.

### Path Guard

- Rejects null bytes in paths
- Resolves symlink chains and verifies target is within allowed directory
- Blocks `../` traversal attempts
- Skills directory is the only allowed read/write path

### Remote Content (install_pack)

- Content guard runs on every downloaded skill *before* writing to disk
- Remote content is untrusted until it passes validation
- SHA-256 hash computed before write for deduplication

---

## Deduplication

### On `install_pack`:
- Compute SHA-256 of downloaded skill content
- Compare against hashes of all existing skills in the directory
- Exact content match (even different filename) → skip, report as duplicate
- Same `name` frontmatter but different content → replace old version (update), report as updated

### On index rebuild (startup):
- If two files declare the same `name` in frontmatter, keep the newer one (by file mtime)
- Warn about the duplicate via MCP logging
- BM25 indexes by skill name — one entry per name, last one wins

---

## Configuration

### Precedence (highest wins):

Environment variables > `~/.mcp-librarian/config.json` > defaults

### Environment Variables

| Variable | Default | Description |
|----------|---------|------------|
| `MCP_LIBRARIAN_HOME` | `~/.mcp-librarian` | Base directory for skills, keys, config |
| `MCP_LIBRARIAN_LOG_LEVEL` | `info` | debug, info, warning, error |
| `MCP_LIBRARIAN_RATE_LIMIT` | `200` | Max requests per minute |
| `MCP_LIBRARIAN_CACHE_SIZE` | `100` | LRU cache max entries |
| `MCP_LIBRARIAN_CACHE_TTL` | `600000` | Cache TTL in ms (default 10 min) |
| `MCP_LIBRARIAN_SKILLS_REPO` | `penumbraforge/mcp-librarian-skills` | GitHub repo for install_pack |
| `GITHUB_TOKEN` | (unset) | GitHub personal access token for authenticated API requests (5,000 req/hour vs 60 unauthenticated). Optional. |

### config.json (optional)

```json
{
  "logLevel": "debug",
  "rateLimit": 200,
  "cacheSize": 100,
  "cacheTtl": 600000,
  "skillsRepo": "penumbraforge/mcp-librarian-skills"
}
```

### Validation

Config is validated at startup. Invalid values produce clear error messages via MCP logging and fall back to defaults. Missing config file is not an error — defaults are sufficient.

---

## Install Experience

### Entry Point

```bash
# Clone and install
git clone https://github.com/penumbraforge/mcp-librarian.git
cd mcp-librarian
node bin/install.js

# Or via npm (future)
npm install -g mcp-librarian
mcp-librarian install
```

### What `install.js` Does

1. Creates `~/.mcp-librarian/` directory structure:
   ```
   ~/.mcp-librarian/
   ├── skills/          ← empty, ready for packs
   ├── keys/
   │   ├── public.pem   ← Ed25519 public key
   │   └── private.pem  ← Ed25519 private key (0o600)
   └── manifest.json    ← skeleton: { "version": 1, "signedAt": null, "skills": {} }
   ```
2. Generates Ed25519 keypair
3. Auto-detects installed MCP clients by scanning for known config files:
   - Claude Code: `~/.claude.json` or `claude mcp` CLI
   - Cursor: `~/.cursor/mcp.json`
   - Windsurf: `~/.windsurf/mcp.json`
   - Others added as ecosystem grows
4. For each detected client, offers to configure (adds the server entry)
5. For unrecognized clients, prints manual configuration instructions:
   ```
   Add this to your MCP client config:
   {
     "mcp-librarian": {
       "command": "node",
       "args": ["/path/to/mcp-librarian/bin/mcp-librarian.js"]
     }
   }
   ```

### Install Script is JavaScript

Not bash. Same language as the server, uses only `node:` built-ins. Works on macOS and Linux without shell compatibility issues. Interactive prompts use `node:readline`.

---

## Error Handling

### Structured Error Types

```javascript
const ERROR_CODES = {
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
  SERVER_ERROR:        -32000,
};
```

Every error response includes:
- Numeric code (from table above)
- Human-readable message
- Context object with relevant details (e.g., skill name, expected format)

Errors are also emitted as MCP log notifications at `error` level.

---

## Rate Limiting

Per-session sliding window counter. Default: 200 requests per 60 seconds. Configurable via env var or config file.

When limit is hit, tool calls return error code `-32003` with a message indicating when the window resets.

Rate limiting prevents runaway tool loops (e.g., an AI agent calling `find_skill` in an infinite retry). It's not access control — stdio is single-client by design.

---

## Project Structure

```
mcp-librarian/
├── bin/
│   ├── mcp-librarian.js        ← Entry point (stdio server)
│   └── install.js               ← Install script (JS)
├── src/
│   ├── transport/
│   │   └── stdio.js             ← NDJSON reader/writer on stdin/stdout
│   ├── protocol/
│   │   ├── dispatcher.js        ← JSON-RPC 2.0 router, MCP lifecycle
│   │   ├── tools.js             ← Tool handlers
│   │   ├── resources.js         ← Resource handlers (skill:// URIs)
│   │   ├── prompts.js           ← Prompt templates
│   │   └── logging.js           ← MCP logging
│   ├── store/
│   │   ├── skill-store.js       ← Load, index, cache, deduplicate skills
│   │   ├── bm25.js              ← BM25 search with stemming + chunking
│   │   ├── lru-cache.js         ← LRU cache (configurable size/TTL)
│   │   └── dedup.js             ← SHA-256 deduplication
│   ├── security/
│   │   ├── ed25519.js           ← Sign/verify skill integrity
│   │   ├── content-guard.js     ← Prompt injection detection
│   │   └── path-guard.js        ← Directory traversal prevention
│   ├── config/
│   │   └── config.js            ← Env > file > defaults, validation
│   └── errors.js                ← Structured error types and codes
├── test/
│   └── test-*.js                ← node:test suites
├── package.json
├── LICENSE                      ← MIT
├── README.md
└── .github/
    └── workflows/
        └── ci.yml               ← Test on push (Node 22, macOS + Ubuntu)
```

---

## Testing

### Framework

`node:test` (built-in) + `node:assert/strict`. Zero test dependencies.

### Coverage Areas

- **Transport:** NDJSON parsing, line buffering, malformed input handling
- **Protocol:** JSON-RPC dispatch, MCP lifecycle (initialize, ping), unknown method handling
- **Tools:** Each tool tested: find_skill (search relevance), load_section (correct chunk), load_skill, list_skills, validate_skill (good and bad input), install_pack (mock fetch), server_status
- **Resources:** List and read operations, sub-resource resolution
- **BM25:** Indexing, search ranking, stemming behavior, empty queries, unicode input
- **LRU Cache:** Eviction at capacity, TTL expiration, cache hits/misses
- **Dedup:** Exact match detection, name collision handling, update vs skip
- **Ed25519:** Key generation, signing, verification, tamper detection, unsigned handling
- **Content Guard:** Each injection pattern category (ChatML, Llama, XML, unicode, etc.), code block allowlisting, edge cases
- **Path Guard:** Traversal attempts, symlinks, null bytes
- **Config:** Env override, file loading, validation errors, missing file fallback
- **Errors:** Correct error codes for each failure mode
- **Rate Limiter:** Window tracking, limit enforcement, reset timing

### CI

GitHub Actions workflow: runs `node --test test/test-*.js` on every push and PR. Matrix: Node 22, macOS + Ubuntu.

---

## Compatibility

| Platform | Support |
|----------|---------|
| macOS (Apple Silicon + Intel) | Full — primary development platform |
| Linux (Ubuntu, Debian, Fedora) | Full — tested in CI |
| Windows (WSL) | Works — WSL provides Linux environment |
| Windows (native) | Not supported — no named pipe transport |

| Node.js | Support |
|---------|---------|
| >= 22.0.0 | Required (modern crypto APIs, built-in test runner) |
| < 22 | Not supported |

| MCP Clients | Auto-configured |
|-------------|----------------|
| Claude Code | Yes (via `claude mcp add` CLI) |
| Cursor | Yes (via `~/.cursor/mcp.json`) |
| Windsurf | Yes (via `~/.windsurf/mcp.json`) |
| Others | Manual instructions printed |

---

## Deliverables

1. **`penumbraforge/mcp-librarian`** — The server. Clean room rewrite, v3.0.0.
2. **`penumbraforge/mcp-librarian-skills`** — Community skill packs repo with PR-based contributions and automated validation.

---

## Future Additions (Not in Scope)

- npm publishing (`npm install -g mcp-librarian`)
- Homebrew formula
- Docker image
- Skill pack versioning / pinning
- Skill dependency graph (pack A requires pack B)
- Web-based skill pack browser
- Skill analytics (most searched, most loaded)
