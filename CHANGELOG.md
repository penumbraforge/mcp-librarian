# Changelog

All notable changes to mcp-librarian are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning: [SemVer](https://semver.org/).

## [3.1.0] — 2026-08-12

Security hardening, a correctness fix that restored progressive disclosure,
and quality-weighted retrieval ported from the project's earlier lineage.

### Security
- **SSRF protection** (`src/security/net-guard.js`): all web fetching
  (`fetch_page`, `research_topic`, `browse_packs`, DuckDuckGo search) now runs
  through `safeFetch`, which rejects private/loopback/link-local/cloud-metadata
  addresses, pins the vetted IP against DNS-rebinding, re-vets every redirect
  hop, and enforces a streaming byte cap instead of buffering then truncating.
- **`GITHUB_TOKEN` no longer leaks to arbitrary hosts** — the pack fetcher
  attaches the token only to `raw.githubusercontent.com` / `api.github.com`,
  and validates caller-supplied pack URLs against an allowlist unless
  `allowArbitraryPackUrls` is set.
- **Path-traversal fixes** — `export_pack` and `create_skill` enforce strict
  name/filename shapes and resolve through the (previously dead)
  `path-guard.js`. `SkillStore`'s duplicate validator now delegates to it.
- **`install_pack` is now crash-safe** — writes new skills first and removes
  replaced ones only after every write succeeds, with rollback. The old
  delete-then-write order destroyed existing skills on a mid-install failure.
- **Fetched web content is content-guarded** and wrapped in explicit
  untrusted-data delimiters. `find_and_load` auto-research is now **opt-in**
  (`autoResearch`, default off) and its coercive "create a skill now"
  instruction was neutralized.

### Fixed
- **Progressive disclosure survives cache eviction** — `getSection`,
  `getSectionSlugs`, and `list_skills` sections previously read only from the
  TTL cache, so an idle server returned `SKILL_NOT_FOUND` and empty section
  lists after ~10 minutes. Section slugs now live in the authoritative skill
  map; `getSection` reads through the disk fallback.
- **Runtime signing actually happens** — `create_skill` and `install_pack`
  sign when a private key is present, so new skills become `VERIFIED` instead
  of sitting `UNSIGNED` until a manual `sign` run.
- Multi-byte UTF-8 corruption in the pack fetcher (`Buffer.concat`, not
  `chunks.join`).
- `validate_skill` / `create_skill` return a proper `INVALID_INPUT` error on
  missing arguments instead of crashing with a `TypeError`.

### Added
- **Quality-weighted retrieval** — BM25 relevance is blended with a heuristic
  per-skill quality score (specificity, examples, actionability, source
  authority). Configurable via `qualityWeighting` / `qualityWeight`; off yields
  bit-identical pure BM25. Quality is surfaced in `list_skills` and
  `skill_status`. Ported from the project's UDS lineage (see `docs/design/`).
- DuckDuckGo search falls back to the `lite` endpoint when the primary markup
  yields nothing.
- `bin/migrate.js` — one-shot migration from the old `<name>/SKILL.md` layout
  to the flat `<name>.md` layout.

### Changed
- **License: MIT → Apache-2.0** (patent grant).
- BM25 precomputes per-chunk term-frequency maps instead of rescanning the
  token array per query term.
- `package.json` gains a `files` allowlist so `npm publish` ships only the
  intended files.

## [3.0.0] — 2026-03-21

Initial release of the stdio MCP skills server: BM25 search with progressive
disclosure (`find_skill` / `find_and_load` / `load_section` / `load_skill`),
Ed25519 manifest signing, content guard, community pack install, zero runtime
dependencies.
