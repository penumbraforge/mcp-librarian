# mcp-librarian

mcp-librarian is a local Model Context Protocol (MCP) stdio server for indexing and retrieving Markdown "skill" documents. It provides quality-weighted BM25 search, section-level retrieval, locally generated Ed25519 integrity status, skill authoring/export tools, and opt-in network research and pack installation.

**Status: experimental.** The package is at version 3.1.0, but it has not been exercised across every MCP client, filesystem, or hostile-content case, and the boundaries below still need enforcement work.

The integrity and content-safety features are useful signals, not an enforcement sandbox or a provenance system. Read the [integrity model](#integrity-model) and [current limits](#current-implementation-limits) before putting untrusted material in an agent's context.

**Documentation:** [penumbraforge.com/librarian/wiki](https://penumbraforge.com/librarian/wiki/)

![A demonstration of mcp-librarian reporting indexed integrity status](demo/librarian.gif)

## Quick start

Requires Node.js 22 or later.

```bash
git clone https://github.com/penumbraforge/mcp-librarian.git
cd mcp-librarian
node bin/install.js
```

The installer creates `~/.mcp-librarian/`, generates a local Ed25519 keypair, installs any bundled starter skills that are not already present, and offers to configure detected MCP clients. Existing keys are preserved unless you approve regeneration.

For a client that is not detected automatically:

```json
{
  "mcpServers": {
    "mcp-librarian": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-librarian/bin/mcp-librarian.js"]
    }
  }
}
```

The server uses only Node.js built-ins at runtime. That removes third-party runtime packages from this repository; it does not remove risk from Node.js, the repository/download path, MCP clients, installed skills, remote packs, or fetched web content.

## Retrieval model

Skills are Markdown files with small YAML-like frontmatter and `##`/`###` sections. At server startup, mcp-librarian:

1. reads `.md` files from the configured skills directory;
2. parses a limited frontmatter shape;
3. computes a heuristic quality score;
4. evaluates each file against the local signature manifest and public key;
5. builds a BM25 index over metadata and sections; and
6. caches full content with disk fallback after cache eviction.

Search ranking blends BM25 relevance with a heuristic quality score by default. Quality considers document structure, examples, actionability, and declared source domains. It does not establish that a document is correct, current, safe, or authoritative.

## Tools

The current server exposes 14 tools: nine always-local tools, one normally-local tool that can be configured to research automatically, and four explicit network tools.

### Always local

| Tool | Current behavior |
|------|------------------|
| `find_skill` | Search the in-memory BM25 index and return ranked matches. |
| `load_skill` | Return a complete skill plus its section slugs. Does not enforce integrity status at read time. |
| `load_section` | Return one indexed section by slug. Does not enforce integrity status at read time. |
| `list_skills` | List indexed metadata, quality scores, sections, and integrity status. |
| `skill_status` | Return the integrity result calculated at the last startup/rebuild. |
| `validate_skill` | Run structural checks plus the heuristic content guard without writing. |
| `create_skill` | Validate and write a skill; re-sign the local collection if a private key is present. |
| `export_pack` | Write selected local skills and a `pack.json` under the configured home directory. |
| `server_status` | Return server/index/config summary. See the version-reporting limit below. |

### Conditional network behavior

| Tool | Current behavior |
|------|------------------|
| `find_and_load` | Load the top local match. If no strong match exists, it stays local by default; with `autoResearch: true`, it can invoke web research. |

### Explicit network tools

| Tool | Default destination | Current behavior |
|------|---------------------|------------------|
| `browse_packs` | `raw.githubusercontent.com` | Fetch the configured community-pack index. |
| `install_pack` | `raw.githubusercontent.com` | Fetch a pack manifest/files, screen them, write accepted files, and optionally re-sign the local collection. |
| `research_topic` | DuckDuckGo and result pages | Search, rank, and fetch a bounded set of pages. |
| `fetch_page` | Caller-provided HTTP(S) URL | Fetch one page and return extracted text. |

There is no intentional telemetry or startup phone-home. Outbound requests occur when one of the explicit network tools is called, or when `find_and_load` auto-research is deliberately enabled and no strong local match is found.

## Skill format

```markdown
---
name: my-skill
version: 1.0.0
category: [development, patterns]
description: Brief description for search results
sources: [https://docs.example.com/guide]
---

## Section Heading

Content here.

### Sub-section

More focused content for `load_section`.
```

The parser is intentionally limited; it is not a general YAML parser. Use `validate_skill` before `create_skill`, and review the resulting file yourself.

## Integrity model

The installer generates a keypair that belongs to that local installation. Successful writes from `create_skill` and `install_pack` re-sign the local collection when the private key is available; `node bin/mcp-librarian.js sign` signs the current collection manually.

At startup or index rebuild, each skill is labelled:

- `VERIFIED`: the file matched an entry signed by the configured local key.
- `TAMPERED`: a manifest entry existed but its hash/signature did not validate.
- `UNSIGNED`: no usable local manifest/key entry was available.

These labels are advisory metadata. `load_skill`, `load_section`, `find_and_load`, and MCP resource reads do not currently re-verify or refuse `TAMPERED`/`UNSIGNED` content. Integrity is calculated at startup/rebuild and stored with the index; a file changed while the server is running can diverge from that status, especially after the content cache expires. Restart or rebuild to refresh the label, and check `skill_status` before relying on a skill.

A `VERIFIED` label proves only that bytes matched a signature from the local key. It does not authenticate the upstream pack author, review the content, or establish a provenance chain. Material installed from a remote pack is signed locally after acceptance. Bundled or manually copied skills can remain `UNSIGNED` until an explicit signing pass.

## Content guard

The content guard is a pattern-based prompt-injection heuristic. It looks for selected model-control tokens, instruction-override phrases, suspicious Unicode, XML-like control tags, and large encoded payloads. Fenced and indented code blocks are exempt so security/reference skills can contain examples.

The guard runs for `validate_skill`, `create_skill`, and files accepted by `install_pack`. Fetched web text is scanned and wrapped in visible `UNTRUSTED` delimiters; flagged fetched text can still be returned for review. Files dropped directly into the skills directory are indexed at startup without a content-guard pass, and ordinary loads do not rescan them.

The guard can miss adversarial instructions and can flag benign prose. Agents and users must continue to treat all skill and web content as untrusted data.

## Network and pack boundaries

`fetch_page` and page fetches used by `research_topic` route through a network guard that rejects loopback/private/link-local/metadata targets, vets DNS results, pins the selected address, re-vets redirects, applies timeouts, and caps response size. These controls reduce SSRF exposure but are not a guarantee that remote content is safe or truthful.

`install_pack` uses a separate fetch path. By default direct pack manifests must use HTTPS on `raw.githubusercontent.com`; requests are size- and time-bounded, and `GITHUB_TOKEN` is attached only to GitHub hosts in the credential allowlist. Setting `allowArbitraryPackUrls: true` permits caller-provided pack URLs and expands the network trust boundary; non-GitHub hosts do not receive the GitHub credential.

`install_pack` fetches all declared files before writing, applies the heuristic content guard, and attempts rollback if a write fails. It does not currently apply the full `validate_skill` structural validation to every pack file, verify an upstream publisher signature, or provide a durable transaction across all filesystem failures. Review a pack and back up important local skills before installing it.

## Configuration

| Environment variable | Default | Meaning |
|----------------------|---------|---------|
| `MCP_LIBRARIAN_HOME` | `~/.mcp-librarian` | Base directory for skills, keys, manifest, config, and exports. |
| `MCP_LIBRARIAN_LOG_LEVEL` | `info` | `debug`, `info`, `warning`, or `error`. |
| `MCP_LIBRARIAN_RATE_LIMIT` | `200` | Requests per minute. |
| `MCP_LIBRARIAN_CACHE_SIZE` | `100` | LRU cache entries. |
| `MCP_LIBRARIAN_CACHE_TTL` | `600000` | Cache TTL in milliseconds. |
| `MCP_LIBRARIAN_SKILLS_REPO` | `penumbraforge/mcp-librarian-skills` | Repository used for default pack URLs. |
| `MCP_LIBRARIAN_AUTO_RESEARCH` | `false` | Permit no-match `find_and_load` calls to research the web. |
| `MCP_LIBRARIAN_QUALITY_WEIGHT` | `0.4` | Heuristic quality/relevance blend from 0 to 1. |
| `GITHUB_TOKEN` | unset | Higher GitHub limits; sent only to the GitHub hostname allowlist. |

Example `~/.mcp-librarian/config.json`:

```json
{
  "logLevel": "debug",
  "autoResearch": false,
  "qualityWeighting": true,
  "qualityWeight": 0.4,
  "allowArbitraryPackUrls": false
}
```

The config file is trusted local input and is not exhaustively schema-validated. Environment values receive more validation than all equivalent file values. Review configuration changes, particularly repository names, arbitrary pack URLs, rate/cache sizes, and auto-research.

## Current implementation limits

- Package version is `3.1.0`, while `server_status` currently reports a hard-coded `3.0.0`.
- Integrity labels are indexed observations, not load-time access control.
- Directly added disk content bypasses structural/content validation at startup.
- Local re-signing of installed packs does not establish upstream authorship.
- Pack screening and web-content pattern checks are partial defenses, not a sandbox.
- The installer targets common macOS/Linux/WSL client locations; other clients may need manual configuration.

## Community packs

The default pack catalog is [penumbraforge/mcp-librarian-skills](https://github.com/penumbraforge/mcp-librarian-skills). Treat it like any other remote code/content source: inspect the repository's current `main` content, `pack.json`, and each skill before installation. You can point `MCP_LIBRARIAN_SKILLS_REPO` at a different repository you control.

## Migrating an older install

If an older Unix-socket installation stored skills as `<name>/SKILL.md`, inspect and run the one-time converter:

```bash
node bin/migrate.js
```

Back up the existing library first.

## Development

```bash
npm test
node bin/mcp-librarian.js
```

The test suite covers protocol handling, search/index behavior, guards, signing primitives, configuration, caching, and pack/tool paths. Passing tests do not establish security against every hostile skill, URL, filesystem, or MCP client.

## Roadmap

- Re-verify and enforce integrity at every content read.
- Separate upstream publisher attestations from local installation signatures.
- Apply one structural validation contract to direct files, authored skills, and pack installs.
- Replace the heuristic guard with layered, testable trust policies while retaining explicit untrusted-data boundaries.

## License

Apache-2.0. Copyright 2026 [Penumbra Forge](https://penumbraforge.com) (Shadoe Myers). See [LICENSE](LICENSE).
