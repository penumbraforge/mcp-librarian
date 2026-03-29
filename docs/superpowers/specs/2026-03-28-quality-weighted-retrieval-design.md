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

- **Specificity** — ratio of concrete tokens vs total tokens. A token is "concrete" if it matches: `/[a-z]+[A-Z]/` (camelCase), `/_/` (snake_case), `/^--?[a-z]/` (CLI flags), or `/\./` (dotted paths like `fs.readFileSync`). Skills full of API names and CLI flags score high; vague prose scores low.
- **Example density** — `min(1.0, fenced_code_blocks * 0.15 + inline_code_spans * 0.03)`. Count fenced blocks (` ``` `) and inline code (`` `...` ``). A skill with 6+ code blocks and some inline code hits 1.0.
- **Actionability** — presence of step-by-step patterns. Score: `min(1.0, numbered_list_items * 0.08 + imperative_line_starts * 0.06 + command_examples * 0.1)`. Imperative line starts match `/^(Run|Add|Create|Install|Set|Open|Copy|Move|Delete|Update|Enable|Disable|Configure|Build|Deploy|Start|Stop)\b/m`.
- **Source reputation** — if `sources` field exists in YAML frontmatter, score URLs using the tiered pattern matcher (Section 1.2). If no sources, default 0.5.

**Combined score:**
```
quality = 0.7 * (specificity + examples + actionability) / 3 + 0.3 * source_reputation
```

**Edge case:** Skills with zero tokens receive `quality = 0.0`. All dimension ratios default to 0.0 when the denominator is zero.

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
2. If Ollama is reachable, send skills in batches of 5 for 3-dimension LLM scoring (specificity, examples, actionability)
3. LLM scores override heuristic scores for content dimensions
4. Source reputation always stays heuristic (URL pattern matching, no LLM needed)
5. Skills scored by LLM get `scored_by: "llm"` flag — not re-scored unless content hash changes
6. LLM requests use `AbortSignal.timeout(30_000)` — 30 second timeout per batch

**LLM prompt** (same structure as umbrav2's `KnowledgeQualityVerifier`):
```
Score each skill on three dimensions (0.0 to 1.0):
- specificity: concrete APIs, parameters, patterns (1.0) vs vague generalities (0.0)
- examples: rich code snippets and usage examples (1.0) vs no examples (0.0)
- actionability: copy-paste ready (1.0) vs pure background/theory (0.0)

Respond with JSON only:
{"scores": [{"id": "skill_name", "specificity": 0.8, "examples": 0.6, "actionability": 0.9}]}
```

**Failure handling:** If Ollama is unreachable, times out, or scoring fails, heuristic scores remain in effect. No skill is ever dropped or degraded due to a scorer error.

### 1.4 Score Storage

Quality scores stored in `manifest.json` alongside existing `sha256` and `signature` fields:

```json
{
  "skills": {
    "security": {
      "sha256": "abc123...",
      "signature": "def456...",
      "quality": {
        "score": 0.68,
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

**Math check:** `0.7 * (0.8 + 0.7 + 0.65) / 3 + 0.3 * 0.6 = 0.7 * 0.7167 + 0.18 = 0.50 + 0.18 = 0.68`

**Validation:** When reading quality scores from manifest, validate all numeric fields are in [0.0, 1.0]. If any field is missing or invalid, treat the skill as unscored and re-run heuristic scoring on the next maintenance cycle.

When a skill's content hash changes (skill was edited), its quality score is invalidated and re-computed next cycle.

### 1.5 Scoring Lifecycle

1. **On `loadAll()`:** Skills with no quality entry in the manifest get a temporary default score of 0.5. This score is used for retrieval until the next maintenance cycle computes real scores.
2. **During `runMaintenance()` — heuristic pass (synchronous):** For any skill without a quality score, or whose content hash has changed since last scoring, run the heuristic scorer. Store results in manifest with `scored_by: "heuristic"`.
3. **During `runMaintenance()` — LLM pass (asynchronous, after heuristic):** For skills still marked `scored_by: "heuristic"`, attempt LLM scoring in batches of 5. On success, update manifest with `scored_by: "llm"`. On failure, heuristic scores remain.
4. **After scoring:** Call `store.rebuildIndex()` to re-attach updated quality scores to BM25 documents.

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
3. **Edge cases:** If max BM25 score is 0, return empty results. If all BM25 scores are identical, they all normalize to 1.0 and quality becomes the sole differentiator (intended — quality breaks ties).
4. Look up quality score from document meta (attached at index time by `SkillStore`)
5. Compute `final_score = normalized_bm25 * 0.6 + quality * 0.4`
6. Re-sort by `final_score`

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

New optional `sources` field in YAML frontmatter. Because the existing `parseSimpleYaml()` only handles simple `key: value` pairs, sources uses a comma-separated string format (not YAML array syntax):

```yaml
---
name: security
description: "Pentesting reference patterns"
domain: security
version: "1.0"
sources: "https://owasp.org/www-community/attacks/, https://portswigger.net/web-security"
---
```

**Parser extension in `parseSimpleYaml()`:**
- After stripping quotes from the value, if the key is `sources`, split on `, ` (comma-space) to produce an array.
- If the key is `enabled`, coerce `"true"` → `true`, `"false"` → `false` (boolean).
- All other keys remain strings (backward compatible).

**Constraints:**
- Completely optional — existing skills work unchanged (default source reputation = 0.5)
- `validator.js` checks that `sources`, after parsing, is an array of strings, max 20 entries
- Maximum 20 source URLs per skill (prevent abuse)
- `ai-curator.js` `draft_skill` action: modify the LLM prompt to instruct it to include a `sources:` line in generated frontmatter with comma-separated URLs from its research context

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
- Parser coerces `"true"` / `"false"` strings to booleans (see Section 3)
- `SkillStore.loadAll()` skips skills where `frontmatter.enabled === false` when building the BM25 index
- Disabled skills are still loaded into `this.skills` Map (for listing purposes) but excluded from `allSections` passed to `bm25.index()`
- `list_skills` tool shows disabled skills with a `[disabled]` tag
- Users toggle via frontmatter edit or `librarian_curate` tool
- No new MCP tool required

---

## 5. Expertise Summary

New method on `SkillStore`: `buildExpertiseSummary()` → `string`

Returns a compact text listing all enabled skills with domain and description, designed for system prompt injection:

```
KNOWLEDGE AVAILABLE:
- [security] security: Pentesting reference patterns (12 sections)
- [frontend] frontend: React, CSS, accessibility patterns (8 sections)
- [scripting] scripting: Python, Node, Bash, Go patterns (10 sections)
Use find_skill("query") to retrieve specific knowledge.
```

Returns empty string if no enabled skills exist.

**Integration:** The `getStatus()` method in `src/librarian/index.js` gains a new `expertiseSummary` string field populated by calling `this.store.buildExpertiseSummary()`. The `librarian_status` tool handler formats this into its response.

**Data flow:** `listSkills()` in `skill-store.js` gains `quality` (number) and `enabled` (boolean) fields in its return objects, so `list-skills.js` can display them without separate lookups.

---

## 6. Starter Pack "Don't Overwrite" Logic

**Verified: already implemented.** `setup.js` lines 57-61 already check `if (existsSync(destSkill)) { skipped++; continue; }`. No changes needed.

---

## 7. Manifest Preservation During Re-signing

`IntegrityEngine.signAll()` currently creates a brand-new manifest object, wiping any existing quality scores.

**Change:** Before building the new manifest, load the existing one and preserve `quality` blocks:

```js
signAll(skillContents) {
  const existing = this.loadManifest();
  const manifest = { skills: {}, signedAt: new Date().toISOString() };
  for (const [name, content] of Object.entries(skillContents)) {
    manifest.skills[name] = this.signSkill(name, content);
    // Preserve quality scores if content hash unchanged
    if (existing.skills?.[name]?.quality &&
        existing.skills[name].sha256 === manifest.skills[name].sha256) {
      manifest.skills[name].quality = existing.skills[name].quality;
    }
  }
  this.saveManifest(manifest);
  return manifest;
}
```

If the content hash changed, quality is dropped (will be re-scored next maintenance cycle).

---

## 8. Files Changed

### New files:
- `src/store/quality-scorer.js` — Heuristic quality scorer (4 dimensions)
- `src/store/source-reputation.js` — URL authority tier matcher

### Modified files:
- `src/store/bm25.js` — Add quality-weighted blending to `search()`
- `src/store/skill-store.js` — Attach quality scores at index time, add `buildExpertiseSummary()`, extend `listSkills()` return with `quality` and `enabled`
- `src/store/parser.js` — Parse `sources` (comma-separated → array) and `enabled` (string → boolean) in `parseSimpleYaml()`
- `src/librarian/index.js` — Run heuristic scorer during maintenance, LLM scorer when Ollama available, add `expertiseSummary` to `getStatus()`
- `src/librarian/validator.js` — Validate `sources` field (array of strings, max 20)
- `src/librarian/integrity.js` — Preserve quality scores in `signAll()`, read/write quality blocks
- `src/tools/find-skill.js` — Display quality score in output
- `src/tools/list-skills.js` — Show `[disabled]` tag, quality score
- `src/tools/librarian-status.js` — Include expertise summary in response

### Test files:
- `test/test-quality-scorer.js` — Heuristic scoring unit tests, including zero-token edge case
- `test/test-source-reputation.js` — URL tier matching tests for all 5 tiers
- `test/test-quality-retrieval.js` — Blended search integration tests, BM25 normalization edge cases, quality score invalidation on content hash change
- `test/test-skill-enable.js` — Enable/disable filtering in loadAll and listSkills

### Concrete test fixture for success criterion 1:
Given skill A with 3 fenced code blocks and `sources: "https://owasp.org/..."`, and skill B with prose-only content and no sources field, querying their shared topic must return A ranked above B.

---

## 9. Non-Goals

- Semantic embeddings (sentence-transformers) — not portable to zero-dep Node.js
- Web scraping / knowledge generation pipeline — requires aiohttp + BeautifulSoup
- Pack import with collision handling — mcp-librarian's pack model is directory-based, not JSON-based; collision is handled by filesystem
- Full REST API (FastAPI router) — mcp-librarian uses MCP protocol over Unix socket, not HTTP

---

## 10. Success Criteria

1. Skills with rich code examples and authoritative sources rank higher than vague prose (verified by concrete test fixture in Section 8)
2. Quality scores computed automatically — zero user action required
3. Zero new dependencies — heuristic scorer works with Node.js built-ins only
4. Existing skills work unchanged — all new frontmatter fields are optional
5. LLM scoring is purely additive — system works fully without Ollama
6. All existing tests continue to pass
7. `signAll()` preserves quality scores when content is unchanged
8. Disabled skills excluded from search but visible in list
