# mcp-librarian

Zero-dependency MCP skills server. BM25 search, Ed25519 integrity, progressive disclosure.

## What is this?

mcp-librarian is a [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that gives your AI coding agent access to a searchable library of skill files. Skills are markdown documents with structured knowledge — coding patterns, security references, workflow guides, anything your agent needs to know.

**Key features:**
- **BM25 full-text search** with stemming and sub-section chunking
- **Ed25519 signed skills** — tamper detection on every load
- **Content guard** — blocks prompt injection in skill content
- **Install packs from the community** — one tool call to add new skills
- **Create your own skills** — or let your AI agent research and write them
- **Export and share** — package your skills for others
- **Zero dependencies** — only Node.js built-ins, no supply chain risk
- **Works with any MCP client** — Claude Code, Cursor, Windsurf, and more

## Quick Start

```bash
git clone https://github.com/penumbraforge/mcp-librarian.git
cd mcp-librarian
node bin/install.js
```

The installer:
1. Generates Ed25519 signing keys
2. Detects your MCP client (Claude Code, Cursor, Windsurf)
3. Offers to configure it automatically
4. Prints manual instructions if your client isn't detected

## Usage

Once installed, your AI agent has access to these tools:

### Search & Browse

| Tool | What it does |
|------|-------------|
| `find_skill` | Search across all skills. Returns ranked results. |
| `load_skill` | Load a complete skill file. |
| `load_section` | Load a specific section for focused context. |
| `list_skills` | List all installed skills with metadata. |

### Create & Manage

| Tool | What it does |
|------|-------------|
| `create_skill` | Validate and save a new skill. Your AI agent can research a topic and create it. |
| `validate_skill` | Check a skill for structure and content guard compliance without saving. |
| `install_pack` | Download a skill pack from the community repository. |
| `export_pack` | Export your skills as a shareable pack. |

### System

| Tool | What it does |
|------|-------------|
| `server_status` | Version, skill count, index stats, uptime. |
| `skill_status` | Check a specific skill's integrity (VERIFIED / TAMPERED / UNSIGNED). |

### Example Conversations

**Install a skill pack:**
> "Install the security skill pack"

**Create a custom skill:**
> "Create a skill about Kubernetes pod security best practices, using official Kubernetes docs as the primary source"

**Search your library:**
> "Find skills about authentication patterns"

**Export your skills:**
> "Export all my skills as a pack called 'my-team-patterns'"

## Skill Format

Skills are markdown files with YAML frontmatter:

```markdown
---
name: my-skill
version: 1.0.0
category: [development, patterns]
description: Brief description for search results
---

## Section Heading

Content here. Indexed by BM25 at the section level.

### Sub-Section

Finer-grained content. Loaded independently via `load_section`.
```

Drop `.md` files in `~/.mcp-librarian/skills/` and they're automatically indexed.

## Community Skill Packs

Browse and install packs from [penumbraforge/mcp-librarian-skills](https://github.com/penumbraforge/mcp-librarian-skills).

**Contributing:** Fork the skills repo, add your pack in `packs/your-pack-name/`, and open a PR. Automated checks validate structure, frontmatter, and content guard compliance.

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `MCP_LIBRARIAN_HOME` | `~/.mcp-librarian` | Base directory |
| `MCP_LIBRARIAN_LOG_LEVEL` | `info` | debug, info, warning, error |
| `MCP_LIBRARIAN_RATE_LIMIT` | `200` | Max requests per minute |
| `MCP_LIBRARIAN_CACHE_SIZE` | `100` | LRU cache entries |
| `MCP_LIBRARIAN_CACHE_TTL` | `600000` | Cache TTL in ms (10 min) |
| `MCP_LIBRARIAN_SKILLS_REPO` | `penumbraforge/mcp-librarian-skills` | Pack source repo |
| `GITHUB_TOKEN` | (unset) | For higher GitHub API rate limits |

Or use `~/.mcp-librarian/config.json`:

```json
{
  "logLevel": "debug",
  "rateLimit": 200
}
```

## Security

- **Ed25519 signing** — Every skill is hashed (SHA-256) and signed. Tampered files are flagged on load.
- **Content guard** — Scans for prompt injection patterns (ChatML tokens, instruction overrides, Unicode tricks). Blocks in prose, allows in code blocks (security skills need real payloads).
- **Path guard** — Prevents directory traversal and symlink attacks.
- **Rate limiting** — Prevents runaway tool loops.
- **No network access** — The server only fetches from GitHub when you explicitly call `install_pack`. No telemetry, no phone-home.

## Manual Client Configuration

If the installer doesn't detect your MCP client:

```json
{
  "mcp-librarian": {
    "command": "node",
    "args": ["/path/to/mcp-librarian/bin/mcp-librarian.js"]
  }
}
```

## Updating

```bash
cd mcp-librarian
git pull
```

No build step. No dependency install. Changes take effect on next MCP session.

## Requirements

- Node.js >= 22.0.0
- macOS or Linux (Windows via WSL)

## License

MIT — Copyright (c) 2026 [Penumbra Forge](https://penumbraforge.com)
