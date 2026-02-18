# MCP Forge

Hyper-secure intelligent MCP skills server with BM25 search and progressive disclosure.

Zero external dependencies. Pure Node.js built-ins.

## Quick Start

```bash
git clone git@github.com:rngdz/mcp-forge.git
cd mcp-forge
bash bin/install.sh
node bin/mcp-forge.js
```

## What It Does

MCP Forge serves skill documents to AI coding assistants (Claude Code, Crush, Aider) with **intelligent retrieval** instead of dumping entire files. Models get only the ~300-600 token chunks they need.

### Tool Hierarchy

| Tool | Returns | Tokens | Use Case |
|------|---------|--------|----------|
| `find_skill` | Top-K ranked chunks via BM25 | ~300-600 | Primary: "I need async patterns" |
| `load_section` | Single section by heading | ~50-300 | "Give me the BullMQ section" |
| `list_skills` | Compact catalog | ~100 | "What skills exist?" |
| `load_skill` | Full file | ~500-1500 | Legacy compat |
| `skill_status` | Integrity status | ~50 | Tamper detection |
| `librarian_curate` | AI curation (librarian only) | varies | "Analyze this skill" |
| `librarian_promote` | Stage → live (librarian only) | varies | Promote drafted content |
| `librarian_status` | Worker status | ~100 | Check librarian health |

## Architecture

```
Client (Claude Code / Crush / Aider)
  → mcp-forge-stdio.js (NDJSON ↔ frame proxy)
    → Unix domain socket (~/.mcp-forge/forge.sock)
      → mcp-forge server
        ├─ HMAC challenge-response auth
        ├─ Rate limiter (100 req/min)
        ├─ MCP JSON-RPC dispatcher
        ├─ 8 tools
        ├─ Skill store (BM25 + LRU cache)
        ├─ Integrity engine (Ed25519 + SHA-256)
        ├─ Librarian worker (5 min cycle + AI on-demand)
        └─ Audit log (hash-chained JSONL)
```

## Security Model

| Layer | Protection |
|-------|-----------|
| Network | UDS only — no TCP/HTTP |
| Auth | HMAC-SHA256 challenge-response, client/librarian roles |
| Integrity | Ed25519 signatures + SHA-256 manifest, verify every load |
| Content | Guard blocks injection/poisoning, staging gate |
| Audit | Hash-chained append-only JSONL |
| Supply chain | Zero dependencies |

## Client Configuration

**Claude Code** (`~/.claude/settings.json`):
```json
{
  "mcpServers": {
    "forge": {
      "command": "node",
      "args": ["/path/to/mcp-forge/bin/mcp-forge-stdio.js"]
    }
  }
}
```

**Auto-start** (macOS):
```bash
launchctl load ~/Library/LaunchAgents/com.mcp-forge.server.plist
```

## Testing

```bash
node --test test/test-*.js
```

## License

MIT
