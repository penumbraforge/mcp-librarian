# mcp-librarian

**A signed, integrity-verified skill supply chain for AI agents.** Zero-dependency MCP server with quality-weighted BM25 search, Ed25519 skill signing, prompt-injection defense, and progressive disclosure.

Part of [Penumbra Forge](https://penumbraforge.com) — security tooling for the AI-agent era.

## What is this?

mcp-librarian is a [Model Context Protocol](https://modelcontextprotocol.io) server that gives your AI coding agent a searchable library of **skills** — markdown documents holding structured knowledge (coding patterns, security references, workflow guides). Instead of dumping whole files into context, the agent searches, then pulls exactly the section it needs.

It treats skills as a **supply chain to secure**, not just files to serve: skills are Ed25519-signed and integrity-checked on load, all content passes a prompt-injection guard, and every network path is SSRF-hardened and credential-scoped.

**Key features:**
- **Quality-weighted BM25 search** — relevance blended with a heuristic skill-quality score (specificity, examples, actionability, source authority). Section-level chunking with stemming.
- **Progressive disclosure** — `find_and_load` returns just the matching section; `load_section` pulls one slug; `load_skill` pulls the whole file. Survives cache eviction (reads through disk).
- **Ed25519 signing** — skills are hashed (SHA-256) and signed; tampering is flagged on load. Signing happens automatically on `create_skill` / `install_pack` when a key is present.
- **Prompt-injection defense** — a content guard scans skill content *and* any fetched web content; web content is wrapped in explicit untrusted-data delimiters.
- **SSRF-hardened networking** — every fetch rejects private/loopback/metadata addresses, pins the resolved IP against rebinding, and re-vets each redirect hop.
- **Zero dependencies** — only Node.js built-ins. No supply chain risk of its own.
- **Works with any MCP client** — Claude Code, Cursor, Windsurf, and more.

## Quick Start

```bash
git clone https://github.com/penumbraforge/mcp-librarian.git
cd mcp-librarian
node bin/install.js
```

The installer generates Ed25519 signing keys, detects your MCP client, and offers to configure it (or prints manual instructions).

## Tools

The agent gets 14 tools. Ten are **local** (no network). Four are **network** tools, called out explicitly so you always know when the server reaches out.

### Local tools

| Tool | What it does |
|------|-------------|
| `find_skill` | Quality-weighted BM25 search. Returns ranked results with scores. |
| `find_and_load` | Search and return the top skill's content in one call (progressive disclosure). |
| `load_skill` | Load a complete skill file plus its section slugs. |
| `load_section` | Load one section by slug for focused context. |
| `list_skills` | List installed skills with metadata, quality score, and section slugs. |
| `skill_status` | A skill's integrity: `VERIFIED` / `TAMPERED` / `UNSIGNED`. |
| `validate_skill` | Check structure + content-guard compliance without saving. |
| `create_skill` | Validate and save a new skill (auto-signed if a key is present). |
| `export_pack` | Export your skills as a shareable pack. |
| `server_status` | Version, skill count, index stats, config. |

### Network tools

| Tool | Reaches | What it does |
|------|---------|-------------|
| `browse_packs` | `raw.githubusercontent.com` | List community packs from the skills repo. |
| `install_pack` | `raw.githubusercontent.com` | Download and install a community pack (auto-signed). |
| `research_topic` | DuckDuckGo + fetched pages | Search the web, rank sources by authority, fetch top results. |
| `fetch_page` | the given URL | Fetch one page's readable text. |

`find_and_load` is network-capable **only when auto-research is enabled** (`autoResearch`, off by default). With it off, a no-match returns a suggestion to call `research_topic` explicitly.

## Network behavior

There is **no telemetry and no phone-home.** The server makes outbound requests only through the four network tools above, and only when the agent calls them:

- `browse_packs` / `install_pack` fetch from `raw.githubusercontent.com` (your configured skills repo).
- `research_topic` queries DuckDuckGo and fetches the pages it ranks; `fetch_page` fetches the URL you pass.
- `GITHUB_TOKEN`, if set, is sent **only** to `raw.githubusercontent.com` / `api.github.com` — never to arbitrary hosts.
- All fetches are SSRF-guarded (private/loopback/link-local/cloud-metadata addresses rejected, IP pinned against DNS rebinding, redirects re-vetted) and size-capped.
- Fetched web content is run through the content guard and wrapped in untrusted-data delimiters before the agent sees it.

## Skill Format

```markdown
---
name: my-skill
version: 1.0.0
category: [development, patterns]
description: Brief description for search results
sources: [https://docs.example.com/guide]   # optional; boosts quality score
---

## Section Heading

Content here. Indexed by BM25 at the section level.

### Sub-Section

Finer-grained content. Loaded independently via `load_section`.
```

Drop `.md` files in `~/.mcp-librarian/skills/` — they're indexed at server start.

## Community Skill Packs

Browse and install packs from [penumbraforge/mcp-librarian-skills](https://github.com/penumbraforge/mcp-librarian-skills). A CI workflow there validates pack structure, frontmatter, and content-guard compliance on every PR.

**Contributing:** fork the skills repo, add your pack under `packs/your-pack-name/`, and open a PR.

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `MCP_LIBRARIAN_HOME` | `~/.mcp-librarian` | Base directory |
| `MCP_LIBRARIAN_LOG_LEVEL` | `info` | debug, info, warning, error |
| `MCP_LIBRARIAN_RATE_LIMIT` | `200` | Max requests per minute |
| `MCP_LIBRARIAN_CACHE_SIZE` | `100` | LRU cache entries |
| `MCP_LIBRARIAN_CACHE_TTL` | `600000` | Content cache TTL in ms |
| `MCP_LIBRARIAN_SKILLS_REPO` | `penumbraforge/mcp-librarian-skills` | Pack source repo |
| `MCP_LIBRARIAN_AUTO_RESEARCH` | `false` | Allow `find_and_load` to auto-fetch from the web |
| `MCP_LIBRARIAN_QUALITY_WEIGHT` | `0.4` | Quality vs. relevance blend (0–1) |
| `GITHUB_TOKEN` | (unset) | Higher GitHub rate limits (sent to GitHub hosts only) |

Or `~/.mcp-librarian/config.json`:

```json
{
  "logLevel": "debug",
  "autoResearch": false,
  "qualityWeighting": true,
  "qualityWeight": 0.4,
  "allowArbitraryPackUrls": false
}
```

## Security

- **Ed25519 signing** — every skill is hashed (SHA-256) and signed; tampered files are flagged on load. `create_skill` and `install_pack` sign automatically when a signing key exists.
- **Content guard** — scans for prompt-injection patterns (ChatML tokens, instruction overrides, Unicode tricks) in skill content *and* fetched web content. Blocks in prose, allows in code fences (security skills need real payloads).
- **SSRF guard** — outbound fetches reject private/loopback/link-local/metadata addresses, pin the resolved IP, and re-vet every redirect.
- **Path guard** — prevents directory traversal and symlink escape on every write (`create_skill`, `install_pack`, `export_pack`).
- **Credential scoping** — `GITHUB_TOKEN` is sent to GitHub hosts only.
- **Opt-in web research** — `find_and_load` never reaches the network on a weak match unless you enable it.
- **Rate limiting** — bounds runaway tool loops.

## Manual Client Configuration

```json
{
  "mcp-librarian": {
    "command": "node",
    "args": ["/path/to/mcp-librarian/bin/mcp-librarian.js"]
  }
}
```

## Migrating an older install

If you previously ran the Unix-socket lineage (skills stored as `<name>/SKILL.md`), convert to the flat layout once:

```bash
node bin/migrate.js
```

## Roadmap

- Quality scoring via a local LLM (Ollama) on top of the current heuristics.
- Skill provenance chains — signed attestations of where a skill's content came from.
- Publish to npm (`npm install -g mcp-librarian`).

## Requirements

- Node.js >= 22.0.0
- macOS or Linux (Windows via WSL)

## License

Apache-2.0 — Copyright 2026 [Penumbra Forge](https://penumbraforge.com) (Shadoe Myers)
