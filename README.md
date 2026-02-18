# MCP Librarian

Intelligent MCP skills server — BM25 search, progressive disclosure, Ed25519 integrity, zero dependencies.

## Quick Start

```bash
git clone git@github.com:rngdz/mcp-librarian.git
cd mcp-librarian
bash bin/install.sh    # generates keys, signs skills, configures Claude Code + cclocal
node bin/mcp-librarian.js
```

The installer automatically configures:
- **Claude Code** (`~/.claude.json` mcpServers)
- **cclocal** (`~/.claude-local/claude.json` mcpServers)
- **Crush** (if config exists)
- **launchd** auto-start plist

## How It Works

Skills are parsed into sections at `##` headings, indexed with BM25. Models get only the relevant ~300-600 token chunks instead of entire files.

| Tool | Returns | Use Case |
|------|---------|----------|
| `find_skill` | Top-K ranked chunks via BM25 | "I need SQL injection testing patterns" |
| `load_section` | Single section by heading | "Give me the BullMQ section from automation" |
| `list_skills` | Compact catalog with domain labels | "What skills exist?" |
| `load_skill` | Full file | Legacy compat |
| `skill_status` | Integrity check | Tamper detection |
| `add_skill` | Create from template | Standardized skill creation |
| `librarian_curate` | AI curation via Ollama | Analyze/improve skills |
| `librarian_promote` | Stage → live | Promote drafted content |
| `librarian_status` | Worker health | Check maintenance status |

Every result includes a **domain label** (`[security]`, `[frontend]`, `[scripting]`, `[automation]`, `[general]`) so models never confuse pentesting reference material with instructions.

## Adding Skills

Skills follow a standard template:

```markdown
---
name: my-skill
description: "Short description (max 200 chars)"
domain: scripting
version: "1.0"
---

## Overview
Brief overview.

## Core Patterns
Key patterns with code blocks.

## Examples
Practical examples.
```

Use the `add_skill` tool (librarian role) or drop a SKILL.md into `skills/<name>/` and re-sign.

## Security

| Layer | Protection |
|-------|-----------|
| Network | Unix domain socket only — no TCP/HTTP |
| Auth | HMAC-SHA256 challenge-response, client/librarian RBAC |
| Integrity | Ed25519 signatures + SHA-256 manifest, verified every load |
| Content | Context-aware guard (prose-only injection detection, code blocks exempt) |
| Audit | Hash-chained append-only JSONL log |
| Supply chain | Zero external dependencies |

The content guard is designed for dual-use: pentesting skills with `<script>` tags, SQL injection payloads, and exploit code in code blocks pass cleanly. Only structural prompt injection in prose text (ChatML tokens, instruction overrides, role impersonation) is blocked.

## Architecture

```
Client (Claude Code / cclocal / Crush / Aider)
  → mcp-librarian-stdio.js (NDJSON ↔ frame proxy)
    → Unix domain socket (~/.mcp-librarian/librarian.sock)
      → mcp-librarian server
        ├─ HMAC challenge-response auth
        ├─ Rate limiter (200 req/min)
        ├─ MCP JSON-RPC dispatcher
        ├─ 9 tools
        ├─ Skill store (BM25 + LRU cache)
        ├─ Ed25519 integrity engine
        ├─ Librarian worker (5 min maintenance + AI on-demand)
        └─ Hash-chained audit log
```

## Testing

```bash
node --test test/test-*.js    # 70 tests
```

## License

MIT
