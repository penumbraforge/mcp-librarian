# mcp-librarian

A local skill library for MCP-speaking coding agents. Zero-dependency MCP server with BM25 search over skill sections, Ed25519 signing on write, integrity checks on load, and progressive disclosure to keep context small.

**Status: experimental, pre-1.0.** It works, but it hasn't been exercised across many setups, and interfaces may still change. The security features are extra layers, not guarantees — read the [Security](#security) section for what each one actually does.

Part of [Penumbra Forge](https://penumbraforge.com).

**Full documentation:** [penumbraforge.com/librarian/wiki](https://penumbraforge.com/librarian/wiki/)

![signed skills: tamper a file and the server reports TAMPERED on load](demo/librarian.gif)

## What is this?

mcp-librarian is a [Model Context Protocol](https://modelcontextprotocol.io) server that gives your AI coding agent a searchable library of **skills** — markdown documents holding structured knowledge (coding patterns, security references, workflow guides). Instead of dumping whole files into context, the agent searches, then pulls the section it needs.

Because skills are files an agent will read and act on, the server also tries to make tampering visible and to reduce what an untrusted skill can talk the agent into: skills are Ed25519-signed and integrity-checked on load, content is scanned for known prompt-injection patterns, and outbound fetches go through an SSRF check with credentials scoped to GitHub hosts.

**What it does:**
- **Quality-weighted BM25 search** — relevance blended with a heuristic skill-quality score (specificity, examples, actionability, source authority). Section-level chunking with stemming.
- **Progressive disclosure** — `find_and_load` returns just the matching section; `load_section` pulls one slug; `load_skill` pulls the whole file. Survives cache eviction (reads through disk).
- **Ed25519 signing** — skills are hashed (SHA-256) and signed; a file that changed since signing is flagged on load. Signing happens automatically on `create_skill` / `install_pack` when a key is present.
- **Content scanning** — a content guard checks skill content *and* any fetched web content against a list of prompt-injection patterns, and wraps web content in explicit untrusted-data delimiters. This is pattern matching, so it is best-effort: it will miss things, and it is not a substitute for reviewing skills you install.
- **SSRF checks on outbound fetches** — fetches reject private/loopback/metadata addresses, pin the resolved IP against rebinding, and re-vet each redirect hop.
- **Zero dependencies** — only Node.js built-ins, so this repo is all there is to audit.
- **MCP clients** — the installer can configure Claude Code, Cursor, and Windsurf; other MCP clients can be pointed at it manually, though they're less tested.

## Quick Start

```bash
git clone https://github.com/penumbraforge/mcp-librarian.git
cd mcp-librarian
node bin/install.js
```

The installer generates Ed25519 signing keys, looks for Claude Code, Cursor, and Windsurf, and offers to configure whichever it finds (or prints manual instructions).

## Tools

The agent gets 14 tools. Ten are **local** (no network). Four are **network** tools, listed separately so it's clear which ones reach out.

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

`find_and_load` reaches the network only when auto-research is enabled (`autoResearch`, off by default). With it off, a no-match returns a suggestion to call `research_topic` explicitly.

## Network behavior

There is no telemetry or phone-home code in the server. Outbound requests come from the four network tools above, when the agent calls them:

- `browse_packs` / `install_pack` fetch from `raw.githubusercontent.com` (your configured skills repo). Setting `allowArbitraryPackUrls: true` lets `install_pack` fetch a pack from another host; it is off by default, and such requests are sent without credentials.
- `research_topic` queries DuckDuckGo (`html.duckduckgo.com`, falling back to `lite.duckduckgo.com`) and fetches the pages it ranks; `fetch_page` fetches the URL you pass.
- `GITHUB_TOKEN`, if set, is attached only for requests to `raw.githubusercontent.com` and `api.github.com`.
- Fetches go through the SSRF guard (private/loopback/link-local/cloud-metadata addresses rejected, IP pinned against DNS rebinding, redirects re-vetted) and are size-capped.
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

Browse and install packs from [penumbraforge/mcp-librarian-skills](https://github.com/penumbraforge/mcp-librarian-skills). A CI workflow there checks pack structure, frontmatter, and content-guard compliance on incoming PRs. The packs are community-contributed, so read one before installing it.

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

These are layers, not guarantees. They're worth understanding individually so you know what each one covers.

- **Ed25519 signing** — skills are hashed (SHA-256) and signed; a file edited after signing is flagged on load. `create_skill` and `install_pack` sign automatically when a signing key exists. This detects changes on disk; it does not tell you whether the skill's content was trustworthy to begin with.
- **Content guard** — a regex pattern list for known prompt-injection shapes (ChatML tokens, instruction overrides, Unicode tricks), applied to skill content *and* fetched web content. It flags matches in prose and skips code fences, since security skills need real payloads. Pattern matching catches known forms and misses novel ones, so treat it as a filter rather than protection.
- **SSRF guard** — outbound fetches reject private/loopback/link-local/metadata addresses, pin the resolved IP, and re-vet every redirect.
- **Path guard** — checks for directory traversal and symlink escape on writes (`create_skill`, `install_pack`, `export_pack`).
- **Credential scoping** — `GITHUB_TOKEN` is attached only for requests to GitHub hosts.
- **Opt-in web research** — with `autoResearch` off (the default), `find_and_load` does not reach the network on a weak match.
- **Rate limiting** — bounds runaway tool loops.

If you find a hole in any of this, an issue or a PR is welcome.

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
