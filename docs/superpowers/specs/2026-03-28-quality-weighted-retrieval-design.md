# Quality-Weighted Retrieval — Design Spec

**Date:** 2026-03-28
**Status:** Approved
**Author:** Shadoe Myers

Backport umbrav2's knowledge quality system to mcp-librarian. Improve retrieval accuracy by scoring skills on content quality and source reputation, then blending quality scores with BM25 relevance at search time. All features maintain zero external dependencies.

---

## 1. Quality Scoring System

Two scoring layers: heuristic baseline (always runs) + optional LLM upgrade (when Ollama is available).

### 1.1 Heuristic Scorer

New file: `src/store/quality-scorer.js`

Scores every skill on 4 dimensions (0.0 to 1.0) using pure content analysis:

- **Specificity** — ratio of concrete tokens (API names, CLI flags, code identifiers, camelCase/snake_case words) vs total tokens. Skills with precise references score high; vague prose scores low.
- **Example density** — count of fenced code blocks and inline code spans relative to total content length. More code examples = higher score.
- **Actionability** — presence of step-by-step patterns: numbered lists, imperative verbs at line starts ("Run", "Add", "Create"), command examples, copy-paste-ready snippets.
- **Source reputation** — if `sources` field exists in YAML frontmatter, score URLs using the tiered pattern matcher. If no sources, default 0.5.

**Combined score:**
```
quality = 0.7 * (specificity + examples + actionability) / 3 + 0.3 * source_reputation
```

Weights match umbrav2's proven formula.

### 1.2 Source Reputation Scorer

New file: `src/store/source-reputation.js`

Direct port of umbrav2's `knowledge_sources.py`. Fast hostname-pattern lookup (no LLM call) that ranks URLs by authority tier:

| Tier | Score | Examples |
|------|-------|----------|
| 1 | 1.0 | Official docs (readthedocs.io, docs.*.com, react.dev, python.org) |
| 2 | 0.8 | Established references (MDN, Wikipedia, RFCs, cppreference, arxiv) |
| 3 | 0.6 | Quality community (Stack Overflow, GitHub, GitLab, HN) |
| 4 | 0.4 | Blogs/tutorials (Medium, dev.to, Substack, Hashnode, baeldung) |
| 5 | 0.2 | Unknown/unverified (default) |

When multiple source URLs are present, use the highest-scoring one.

### 1.3 LLM Scorer (optional Ollama upgrade)

Runs during the librarian's 5-minute maintenance cycle. Uses the existing Ollama integration from `ai-curator.js`.

**Behavior:**
1. During maintenance, check for skills with `scored_by: "heuristic"` in manifest
2. If Ollama is reachable, send unscored skills for 3-dimension LLM scoring (specificity, examples, actionability)
3. LLM scores override heuristic scores for content dimensions
4. Source reputation always stays heuristic (URL pattern matching, no LLM needed)
5. Skills scored by LLM get `scored_by: "llm"` flag — not re-scored unless content hash changes

**LLM prompt** (same structure as umbrav2's `KnowledgeQualityVerifier`):
```
Score each skill section on three dimensions (0.0 to 1.0):
- specificity: concrete APIs, parameters, patterns (1.0) vs vague generalities (0.0)
- examples: rich code snippets and usage examples (1.0) vs no examples (0.0)
- actionability: copy-paste ready (1.0) vs pure background/theory (0.0)

Respond with JSON only:
{"scores": [{"id": "skill_name", "specificity": 0.8, "examples": 0.6, "actionability": 0.9}]}
```

**Failure handling:** If Ollama is unreachable or scoring fails, heuristic scores remain in effect. No skill is ever dropped or degraded due to a scorer error.

### 1.4 Score Storage

Quality scores stored in `manifest.json` alongside existing `sha256` and `signature` fields:

```json
{
  "skills": {
    "security": {
      "sha256": "abc123...",
      "signature": "def456...",
      "quality": {
        "score": 0.72,
        "specificity": 0.8,
        "examples": 0.7,
        "actionability": 0.65,
        "source_reputation": 0.6,
        "scored_by": "heuristic",
        "scored_at": "2026-03-28T07:00:00Z"
      }
    }
  }
}
```

When a skill's content hash changes (skill was edited), its quality score is invalidated and re-computed on the next maintenance cycle.

---

## 2. Quality-Weighted Retrieval

### 2.1 Blended Scoring Formula

```
final_score = normalized_bm25 * 0.6 + quality_score * 0.4
```

BM25 remains the dominant signal. Among close-scoring results, quality breaks the tie. Same ratio as umbrav2.

### 2.2 Implementation

In `bm25.js`'s `search()` method:

1. Compute BM25 scores as today
2. Normalize BM25 scores to 0-1 range (divide each by max score in result set)
3. Look up quality score from document meta (attached at index time by `SkillStore`)
4. Compute `final_score = normalized_bm25 * 0.6 + quality * 0.4`
5. Re-sort by `final_score`

`SkillStore.loadAll()` attaches quality scores from the manifest to each section's meta object during indexing. BM25 doesn't need to know where the score came from.

### 2.3 find_skill Output Change

Relevance display changes from:
```
_Relevance: 4.23_
```
to:
```
_Relevance: 0.87 | Quality: 0.72_
```

Both normalized to 0-1 for consistent model reasoning.

---

## 3. Source Tracking in Frontmatter

New optional `sources` field in YAML frontmatter:

```yaml
---
name: security
description: "Pentesting reference patterns"
domain: security
version: "1.0"
sources:
  - https://owasp.org/www-community/attacks/
  - https://portswigger.net/web-security
---
```

**Constraints:**
- Completely optional — existing skills work unchanged (default source reputation = 0.5)
- `validator.js` checks that `sources`, if present, is an array of strings
- `ai-curator.js` `draft_skill` action auto-populates sources when creating skills from research
- Maximum 20 source URLs per skill (prevent abuse)

---

## 4. Skill Enable/Disable

New optional `enabled` field in YAML frontmatter:

```yaml
---
name: security
enabled: true
---
```

**Behavior:**
- Defaults to `true` when absent (backward compatible)
- `SkillStore.loadAll()` skips disabled skills when building the BM25 index
- `list_skills` tool shows disabled skills with a `[disabled]` tag
- Users toggle via frontmatter edit or `librarian_curate` tool
- No new MCP tool required

---

## 5. Expertise Summary

New method on `SkillStore`: `buildExpertiseSummary()`

Returns a compact text listing all enabled skills with domain and description, designed for system prompt injection:

```
KNOWLEDGE AVAILABLE:
- [security] security: Pentesting reference patterns (12 sections)
- [frontend] frontend: React, CSS, accessibility patterns (8 sections)
- [scripting] scripting: Python, Node, Bash, Go patterns (10 sections)
Use find_skill("query") to retrieve specific knowledge.
```

Exposed through the existing `librarian_status` tool response. When the model calls `librarian_status`, it sees what knowledge is available and can make informed retrieval decisions.

---

## 6. Starter Pack "Don't Overwrite" Logic

Change to `src/cli/setup.js`:

Before copying each bundled skill to the user's skills directory, check if the destination skill directory already exists. If it does, skip it. Matches umbrav2's `ensure_starter_packs()` pattern.

Prevents users from losing customized skills when running `mcp-librarian setup` after an update.

---

## 7. Files Changed

### New files:
- `src/store/quality-scorer.js` — Heuristic quality scorer (4 dimensions)
- `src/store/source-reputation.js` — URL authority tier matcher

### Modified files:
- `src/store/bm25.js` — Add quality-weighted blending to `search()`
- `src/store/skill-store.js` — Attach quality scores at index time, add `buildExpertiseSummary()`
- `src/store/parser.js` — Parse `sources` and `enabled` from frontmatter
- `src/librarian/index.js` — Run heuristic scorer during maintenance, LLM scorer when Ollama available
- `src/librarian/validator.js` — Validate `sources` field (array of strings, max 20)
- `src/librarian/integrity.js` — Store/read quality scores in manifest
- `src/tools/find-skill.js` — Display quality score in output
- `src/tools/list-skills.js` — Show `[disabled]` tag, quality score
- `src/tools/librarian-status.js` — Include expertise summary in response
- `src/cli/setup.js` — Don't overwrite existing skills during setup

### Test files:
- `test/test-quality-scorer.js` — Heuristic scoring unit tests
- `test/test-source-reputation.js` — URL tier matching tests
- `test/test-quality-retrieval.js` — Blended search integration tests

---

## 8. Non-Goals

- Semantic embeddings (sentence-transformers) — not portable to zero-dep Node.js
- Web scraping / knowledge generation pipeline — requires aiohttp + BeautifulSoup
- Pack import with collision handling — mcp-librarian's pack model is directory-based, not JSON-based; collision is handled by filesystem
- Full REST API (FastAPI router) — mcp-librarian uses MCP protocol over Unix socket, not HTTP

---

## 9. Success Criteria

1. Skills with rich code examples and authoritative sources rank higher than vague prose
2. Quality scores computed automatically — zero user action required
3. Zero new dependencies — heuristic scorer works with Node.js built-ins only
4. Existing skills work unchanged — all new frontmatter fields are optional
5. LLM scoring is purely additive — system works fully without Ollama
6. All existing tests continue to pass
