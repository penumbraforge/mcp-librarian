# MCP Librarian

Intelligent MCP skills server for offline and online models — BM25 search with stemming, progressive disclosure via sub-section chunking, Ed25519 integrity, zero dependencies.

Built for any MCP-compatible client: Claude Code, cclocal (Ollama), Crush, Aider, or anything that speaks MCP stdio.

## Quick Start

```bash
git clone git@github.com:rngdz/mcp-librarian.git
cd mcp-librarian
bash bin/install.sh
```

The installer handles everything:
1. Generates Ed25519 keypair + 3 HMAC secrets (256-bit each)
2. Signs all skills with SHA-256 + Ed25519 manifest
3. Configures **Claude Code**, **cclocal**, and **Crush** MCP clients automatically
4. Sets up **launchd** auto-start (macOS)

Start manually:
```bash
node bin/mcp-librarian.js
```

Or auto-start on login:
```bash
launchctl load ~/Library/LaunchAgents/com.mcp-librarian.server.plist
```

## Uninstall

Clean removal of all runtime files, secrets, configs, and services:

```bash
bash bin/uninstall.sh
```

Or skip the confirmation prompt:

```bash
bash bin/uninstall.sh --yes
```

This removes:
- `~/.mcp-librarian/` (keys, secrets, audit log, socket)
- launchd service
- MCP server entries from Claude Code, cclocal, and Crush configs

The git repo itself is left untouched — delete it manually if you want.

## How It Works

Skills are Markdown files with YAML frontmatter and `##` / `###` section headings. At startup, the server:

1. Parses all `skills/<name>/SKILL.md` files
2. Chunks sections at `###` sub-headings for fine-grained retrieval
3. Builds a BM25 index with suffix stemming across all chunks
4. Verifies Ed25519 signatures and SHA-256 hashes against the manifest
5. Starts a Unix domain socket server with HMAC challenge-response auth

Models get exactly the chunk they need (~50-300 tokens) instead of entire files.

### Tools

| Tool | Returns | Use Case |
|------|---------|----------|
| `find_skill` | Top-K ranked chunks via BM25 | "SQL injection testing" → relevant chunks with domain labels |
| `load_section` | Single section by heading (fuzzy match) | "BullMQ" matches "BullMQ > Queue Setup" |
| `list_skills` | Compact catalog with domain labels | Discover available knowledge |
| `load_skill` | Full file dump | When you need everything |
| `skill_status` | VERIFIED / TAMPERED / UNSIGNED | Tamper detection |
| `librarian_status` | Worker health, issues, index stats | Check maintenance status |
| `add_skill` | Create from template → staging | Standardized skill creation (librarian role) |
| `librarian_curate` | AI curation via Ollama | Analyze, improve, find gaps, deduplicate (librarian role) |
| `librarian_promote` | Stage → live with content guard | Promote drafted content (librarian role) |

### Progressive Disclosure

`find_skill` returns truncated chunks. If a result is cut off, the model sees:

```
_[truncated — use load_section("automation", "BullMQ") for full content]_
```

This keeps context windows lean while making full content one tool call away.

### BM25 Search

- **Sub-section chunking**: Sections split at `###` sub-headings (255 chunks from 5 skills vs. 63 without chunking)
- **Suffix stemming**: "configuring" matches "configuration" and "configure"
- **Domain labels**: Every result tagged `[security]`, `[frontend]`, `[scripting]`, `[automation]`, or `[general]`
- **Fuzzy heading match**: `load_section` accepts partial headings — "React" finds "React 19 Patterns"

### Skill Format

```markdown
---
name: my-skill
description: "Short description (max 200 chars)"
domain: scripting
version: "1.0"
---

## Overview

Brief overview of this skill's purpose.

### Sub-Topic A

Detailed content. Code blocks welcome.

### Sub-Topic B

More content. Each ### becomes its own BM25 document.

## Another Section

Separate top-level section.
```

Use `###` sub-headings within `##` sections for optimal retrieval granularity.

## Security

| Layer | Protection |
|-------|-----------|
| Network | Unix domain socket only — no TCP, no HTTP |
| Auth | HMAC-SHA256 challenge-response with 5s timeout, timing-safe comparison |
| RBAC | Client role (6 read tools) vs. librarian role (9 tools including write) |
| Integrity | Ed25519 signatures + SHA-256 manifest, verified on every skill load |
| Content | Context-aware guard: blocks prompt injection in prose, allows payloads in code blocks |
| Paths | Null byte rejection, directory traversal prevention, symlink chain resolution |
| Audit | Hash-chained append-only JSONL with HMAC integrity + truncation detection |
| Rate limit | 200 req/min sliding window per connection |
| Supply chain | Zero external dependencies |
| Secrets | 256-bit random keys, 0o600 permissions, separate keys for auth/audit |

The content guard is designed for dual-use: pentesting skills with `<script>` tags, SQL injection payloads, and exploit code in code blocks pass cleanly. Only structural prompt injection in prose (ChatML tokens, instruction overrides, role impersonation, unicode tricks) is blocked.

## Architecture

```
MCP Client (Claude Code / cclocal / Crush / Aider)
  → mcp-librarian-stdio.js (NDJSON ↔ length-prefixed frame proxy)
    → Unix domain socket (~/.mcp-librarian/librarian.sock)
      → mcp-librarian server
        ├─ HMAC challenge-response auth (client / librarian roles)
        ├─ Rate limiter (200 req/min per connection)
        ├─ MCP JSON-RPC dispatcher (protocol v2024-11-05)
        ├─ 9 tools (6 public + 3 librarian-only)
        ├─ Skill store
        │   ├─ BM25 index (sub-section chunks, suffix stemming)
        │   └─ LRU cache (100 entries, 10 min TTL)
        ├─ Ed25519 integrity engine + SHA-256 manifest
        ├─ Librarian worker
        │   ├─ 5 min maintenance cycle (validate, guard, verify, staleness)
        │   └─ AI curation via Ollama (on-demand)
        └─ Hash-chained audit log (HMAC-SHA256, append-only)
```

### File Structure

```
bin/
  mcp-librarian.js          # Main server
  mcp-librarian-stdio.js    # NDJSON ↔ frame proxy for MCP clients
  install.sh                # One-shot setup
  uninstall.sh              # Clean removal
config/
  default.json              # Rate limits, cache, librarian settings
src/
  server/                   # Socket server, auth, framing, protocol
  store/                    # BM25 engine, parser, LRU cache, skill store
  security/                 # Ed25519, HMAC, path guard, permissions, rate limiter, audit log
  librarian/                # Orchestrator, content guard, staging, validator, AI curator
  tools/                    # 9 MCP tool definitions + handlers
skills/                     # Skill files (SKILL.md per directory)
staging/                    # Draft skills awaiting promotion
test/                       # 89 tests across 19 suites
~/.mcp-librarian/           # Runtime (created by installer)
  ed25519.pub/priv          # Signing keypair
  client.secret             # HMAC key for client auth
  librarian.secret          # HMAC key for librarian auth
  audit.secret              # HMAC key for audit log integrity
  librarian.sock            # Unix domain socket
  audit.jsonl               # Hash-chained audit log
```

## Testing

```bash
node --test test/test-*.js    # 89 tests, ~200ms
```

Covers: HMAC auth, BM25 search + stemming + chunking, content guard (prose extraction, injection blocking, pentesting allowlist, unicode tricks, binary payloads), framing, parser + prototype pollution, path traversal + symlinks, Ed25519 integrity, LRU cache, rate limiter, audit log chain verification, skill store integration.

## Requirements

- Node.js >= 22.0.0
- macOS or Linux (Unix domain sockets)
- No external dependencies

## License

MIT — Penumbra Forge
