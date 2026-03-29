# Quality-Weighted Retrieval Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve mcp-librarian retrieval accuracy by scoring skills on content quality and source reputation, then blending quality with BM25 relevance at search time.

**Architecture:** Two-layer quality scoring (heuristic baseline + optional Ollama LLM upgrade) stored in manifest.json. BM25 search blends normalized relevance (60%) with quality (40%). All new code is zero-dependency Node.js.

**Tech Stack:** Node.js 22+, zero external dependencies, existing BM25 engine, existing Ollama integration via fetch()

**Spec:** `docs/superpowers/specs/2026-03-28-quality-weighted-retrieval-design.md`

---

## File Map

### New files:
| File | Responsibility |
|------|---------------|
| `src/store/source-reputation.js` | URL authority tier matcher (5 tiers, regex patterns) |
| `src/store/quality-scorer.js` | Heuristic quality scorer (4 dimensions: specificity, examples, actionability, source reputation) |
| `test/test-source-reputation.js` | Unit tests for all 5 URL tiers |
| `test/test-quality-scorer.js` | Unit tests for heuristic scoring including edge cases |
| `test/test-quality-retrieval.js` | Integration tests for blended BM25+quality search |
| `test/test-skill-enable.js` | Unit tests for enable/disable filtering |

### Modified files:
| File | Changes |
|------|---------|
| `src/store/parser.js` | Parse `sources` (comma-separated → array), `enabled` (string → boolean) |
| `src/store/bm25.js` | Add quality-weighted blending to `search()` |
| `src/store/skill-store.js` | Attach quality scores at index time, add `buildExpertiseSummary()`, extend `listSkills()` |
| `src/librarian/validator.js` | Validate `sources` field (array of strings, max 20) |
| `src/librarian/integrity.js` | Preserve quality scores in `signAll()` |
| `src/librarian/index.js` | Run heuristic+LLM scoring during maintenance, add `expertiseSummary` to `getStatus()` |
| `src/librarian/ai-curator.js` | Add `scoreSkillsWithLLM()` function, update `draftSkill()` prompt for sources |
| `src/tools/find-skill.js` | Display normalized relevance + quality score |
| `src/tools/list-skills.js` | Show `[disabled]` tag and quality score |
| `src/tools/librarian-status.js` | Include expertise summary in response |

---

### Task 1: Source Reputation Scorer

**Files:**
- Create: `src/store/source-reputation.js`
- Create: `test/test-source-reputation.js`

- [ ] **Step 1: Write the failing tests**

```js
// test/test-source-reputation.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { scoreSource, sourceTier } from '../src/store/source-reputation.js';

describe('source-reputation', () => {
  describe('scoreSource', () => {
    it('scores official docs as tier 1 (1.0)', () => {
      assert.equal(scoreSource('https://docs.python.org/3/library/os.html'), 1.0);
      assert.equal(scoreSource('https://react.dev/learn'), 1.0);
      assert.equal(scoreSource('https://kubernetes.readthedocs.io/en/latest/'), 1.0);
    });

    it('scores established references as tier 2 (0.8)', () => {
      assert.equal(scoreSource('https://developer.mozilla.org/en-US/docs/Web'), 0.8);
      assert.equal(scoreSource('https://en.wikipedia.org/wiki/Node.js'), 0.8);
      assert.equal(scoreSource('https://datatracker.ietf.org/doc/html/rfc9116'), 0.8);
    });

    it('scores quality community as tier 3 (0.6)', () => {
      assert.equal(scoreSource('https://stackoverflow.com/questions/123'), 0.6);
      assert.equal(scoreSource('https://github.com/penumbraforge/gate'), 0.6);
    });

    it('scores blogs as tier 4 (0.4)', () => {
      assert.equal(scoreSource('https://medium.com/some-article'), 0.4);
      assert.equal(scoreSource('https://dev.to/user/post'), 0.4);
      assert.equal(scoreSource('https://blog.example.com/post'), 0.4);
    });

    it('scores unknown URLs as tier 5 (0.2)', () => {
      assert.equal(scoreSource('https://randomsite.com/page'), 0.2);
    });

    it('returns 0.2 for empty or invalid input', () => {
      assert.equal(scoreSource(''), 0.2);
      assert.equal(scoreSource(null), 0.2);
      assert.equal(scoreSource(undefined), 0.2);
    });

    it('handles URLs without scheme', () => {
      assert.equal(scoreSource('docs.python.org/3/'), 1.0);
      assert.equal(scoreSource('stackoverflow.com/q/123'), 0.6);
    });
  });

  describe('sourceTier', () => {
    it('returns tier number 1-5', () => {
      assert.equal(sourceTier('https://react.dev/learn'), 1);
      assert.equal(sourceTier('https://developer.mozilla.org/'), 2);
      assert.equal(sourceTier('https://github.com/foo'), 3);
      assert.equal(sourceTier('https://medium.com/bar'), 4);
      assert.equal(sourceTier('https://unknown.com/'), 5);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/penumbra/penumbraprojects/mcp-librarian && node --test test/test-source-reputation.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement source-reputation.js**

```js
// src/store/source-reputation.js
/**
 * Source Reputation Scorer — fast domain-pattern lookup.
 * Port of umbrav2's knowledge_sources.py.
 * Ranks URLs by authority tier (1=official docs, 5=unknown).
 */

const TIER_PATTERNS = [
  // Tier 1 (1.0): Official documentation
  [1, 1.0, [
    /\.readthedocs\.io$/,
    /^docs\./,
    /^developer\.(?!mozilla\.org)/,
    /^react\.dev$/,
    /^web\.dev$/,
    /^python\.org$/,
    /^docs\.python\.org$/,
    /^docs\.rs$/,
    /^doc\.rust-lang\.org$/,
    /^learn\.microsoft\.com$/,
    /^cloud\.google\.com$/,
    /^pytorch\.org$/,
    /^numpy\.org$/,
    /^pandas\.pydata\.org$/,
    /^scikit-learn\.org$/,
    /^kotlinlang\.org$/,
    /^typescriptlang\.org$/,
    /^go\.dev$/,
    /^pkg\.go\.dev$/,
    /^swift\.org$/,
    /^angular\.io$/,
    /^vuejs\.org$/,
    /^api\./,
  ]],

  // Tier 2 (0.8): Established references
  [2, 0.8, [
    /^developer\.mozilla\.org$/,
    /\.wikipedia\.org$/,
    /^(www\.)?rfc-editor\.org$/,
    /^datatracker\.ietf\.org$/,
    /^tools\.ietf\.org$/,
    /^en\.cppreference\.com$/,
    /^cppreference\.com$/,
    /^arxiv\.org$/,
    /^(www\.)?w3\.org$/,
    /^tc39\.es$/,
    /^peps\.python\.org$/,
  ]],

  // Tier 3 (0.6): Quality community
  [3, 0.6, [
    /^stackoverflow\.com$/,
    /^(www\.)?stackexchange\.com$/,
    /^[a-z]+\.stackexchange\.com$/,
    /^github\.com$/,
    /^gist\.github\.com$/,
    /^gitlab\.com$/,
    /^bitbucket\.org$/,
    /^discourse\./,
    /^discuss\./,
    /^forum\./,
    /^news\.ycombinator\.com$/,
  ]],

  // Tier 4 (0.4): Blogs/tutorials
  [4, 0.4, [
    /^medium\.com$/,
    /^[a-z0-9-]+\.medium\.com$/,
    /^dev\.to$/,
    /^(www\.)?substack\.com$/,
    /^[a-z0-9-]+\.substack\.com$/,
    /^hashnode\.com$/,
    /^[a-z0-9-]+\.hashnode\.dev$/,
    /^(www\.)?freecodecamp\.org$/,
    /^(www\.)?geeksforgeeks\.org$/,
    /^(www\.)?tutorialspoint\.com$/,
    /^(www\.)?w3schools\.com$/,
    /^(www\.)?baeldung\.com$/,
    /^(www\.)?digitalocean\.com$/,
    /^(www\.)?towardsdatascience\.com$/,
    /^blog\./,
  ]],
];

const DEFAULT_TIER = 5;
const DEFAULT_SCORE = 0.2;

function extractHostname(url) {
  url = (url || '').trim();
  if (!url) return '';
  if (!/^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//.test(url)) {
    url = 'https://' + url;
  }
  try {
    const parsed = new URL(url);
    let hostname = (parsed.hostname || '').toLowerCase().trim();
    if (hostname.startsWith('www.')) hostname = hostname.slice(4);
    return hostname;
  } catch {
    return '';
  }
}

export function scoreSource(url) {
  const hostname = extractHostname(url);
  if (!hostname) return DEFAULT_SCORE;
  for (const [, score, patterns] of TIER_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(hostname)) return score;
    }
  }
  return DEFAULT_SCORE;
}

export function sourceTier(url) {
  const hostname = extractHostname(url);
  if (!hostname) return DEFAULT_TIER;
  for (const [tier, , patterns] of TIER_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(hostname)) return tier;
    }
  }
  return DEFAULT_TIER;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/penumbra/penumbraprojects/mcp-librarian && node --test test/test-source-reputation.js`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/penumbra/penumbraprojects/mcp-librarian
git add src/store/source-reputation.js test/test-source-reputation.js
git commit -m "feat: add source reputation scorer — 5-tier URL authority ranking"
```

---

### Task 2: Parser Extension (sources + enabled)

**Files:**
- Modify: `src/store/parser.js:46-63` (`parseSimpleYaml`)
- Modify: `test/test-parser.js` (add new test cases)

- [ ] **Step 1: Write failing tests**

Add to `test/test-parser.js`:

```js
describe('sources parsing', () => {
  it('parses comma-separated sources into array', () => {
    const content = `---
name: test
description: "Test skill"
sources: "https://owasp.org, https://portswigger.net"
---

## Section
Content here.`;
    const result = parseSkill(content, 'test');
    assert.deepEqual(result.frontmatter.sources, [
      'https://owasp.org',
      'https://portswigger.net',
    ]);
  });

  it('handles single source', () => {
    const content = `---
name: test
description: "Test"
sources: "https://owasp.org"
---

## Section
Content.`;
    const result = parseSkill(content, 'test');
    assert.deepEqual(result.frontmatter.sources, ['https://owasp.org']);
  });

  it('handles missing sources gracefully', () => {
    const content = `---
name: test
description: "Test"
---

## Section
Content.`;
    const result = parseSkill(content, 'test');
    assert.equal(result.frontmatter.sources, undefined);
  });
});

describe('enabled parsing', () => {
  it('parses enabled: true as boolean true', () => {
    const content = `---
name: test
description: "Test"
enabled: true
---

## Section
Content.`;
    const result = parseSkill(content, 'test');
    assert.strictEqual(result.frontmatter.enabled, true);
  });

  it('parses enabled: false as boolean false', () => {
    const content = `---
name: test
description: "Test"
enabled: false
---

## Section
Content.`;
    const result = parseSkill(content, 'test');
    assert.strictEqual(result.frontmatter.enabled, false);
  });

  it('defaults to undefined when absent', () => {
    const content = `---
name: test
description: "Test"
---

## Section
Content.`;
    const result = parseSkill(content, 'test');
    assert.strictEqual(result.frontmatter.enabled, undefined);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/penumbra/penumbraprojects/mcp-librarian && node --test test/test-parser.js`
Expected: FAIL — sources is a string, enabled is a string

- [ ] **Step 3: Implement parser changes**

In `src/store/parser.js`, modify `parseSimpleYaml()` — after the existing quote-stripping logic, add type coercion:

```js
function parseSimpleYaml(text) {
  const result = Object.create(null);
  for (const line of text.split('\n')) {
    const match = line.match(/^(\w[\w-]*)\s*:\s*(.+)/);
    if (match) {
      const key = match[1];
      if (FORBIDDEN_KEYS.has(key)) continue;
      let val = match[2].trim();
      // Strip quotes
      if ((val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      // Type coercion for known fields
      if (key === 'sources') {
        result[key] = val.split(',').map(s => s.trim()).filter(Boolean);
      } else if (key === 'enabled') {
        result[key] = val !== 'false';
      } else {
        result[key] = val;
      }
    }
  }
  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/penumbra/penumbraprojects/mcp-librarian && node --test test/test-parser.js`
Expected: All tests PASS (including existing tests)

- [ ] **Step 5: Commit**

```bash
cd /Users/penumbra/penumbraprojects/mcp-librarian
git add src/store/parser.js test/test-parser.js
git commit -m "feat: parse sources (comma-separated array) and enabled (boolean) from frontmatter"
```

---

### Task 3: Heuristic Quality Scorer

**Files:**
- Create: `src/store/quality-scorer.js`
- Create: `test/test-quality-scorer.js`

- [ ] **Step 1: Write failing tests**

```js
// test/test-quality-scorer.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { scoreSkill, scoreSpecificity, scoreExamples, scoreActionability } from '../src/store/quality-scorer.js';

describe('quality-scorer', () => {
  describe('scoreSpecificity', () => {
    it('scores high for content with API names and CLI flags', () => {
      const content = 'Use fs.readFileSync to load files. Run --verbose for debug output. Call myFunction with camelCase params.';
      const score = scoreSpecificity(content);
      assert.ok(score > 0.5, `Expected > 0.5, got ${score}`);
    });

    it('scores low for vague prose', () => {
      const content = 'This is a general overview of how things work in the system. There are many approaches to consider.';
      const score = scoreSpecificity(content);
      assert.ok(score < 0.3, `Expected < 0.3, got ${score}`);
    });

    it('returns 0.0 for empty content', () => {
      assert.equal(scoreSpecificity(''), 0.0);
    });
  });

  describe('scoreExamples', () => {
    it('scores high for content with code blocks', () => {
      const content = 'Example:\n```js\nconst x = 1;\n```\nAnother:\n```bash\nnpm install\n```\nAnd `inline` code.';
      const score = scoreExamples(content);
      assert.ok(score > 0.3, `Expected > 0.3, got ${score}`);
    });

    it('scores 0.0 for content with no code', () => {
      const content = 'This is just plain text with no code examples at all.';
      assert.equal(scoreExamples(content), 0.0);
    });
  });

  describe('scoreActionability', () => {
    it('scores high for step-by-step instructions', () => {
      const content = '1. Run npm install\n2. Create the config file\n3. Add the environment variable\nRun the server with node index.js';
      const score = scoreActionability(content);
      assert.ok(score > 0.3, `Expected > 0.3, got ${score}`);
    });

    it('scores low for passive content', () => {
      const content = 'The system was designed to handle various types of requests. It processes data efficiently.';
      const score = scoreActionability(content);
      assert.ok(score < 0.2, `Expected < 0.2, got ${score}`);
    });
  });

  describe('scoreSkill', () => {
    it('computes combined score with source reputation', () => {
      const content = '```js\nfetch(url)\n```\n\n1. Run npm install\n2. Create config\n\nUse fs.readFileSync for sync reads.';
      const sources = ['https://docs.python.org/3/'];
      const score = scoreSkill(content, sources);
      assert.ok(score > 0.5, `Expected > 0.5, got ${score}`);
      assert.ok(score <= 1.0, `Expected <= 1.0, got ${score}`);
    });

    it('uses default source reputation (0.5) when no sources', () => {
      const content = '```js\ncode()\n```';
      const withSources = scoreSkill(content, ['https://docs.python.org/3/']);
      const withoutSources = scoreSkill(content, []);
      // With tier-1 source (1.0) should score higher than default (0.5)
      assert.ok(withSources > withoutSources, 'Authoritative sources should boost score');
    });

    it('returns 0.0 for empty content', () => {
      assert.equal(scoreSkill('', []), 0.0);
    });

    it('returns object with all dimensions when detailed=true', () => {
      const content = '```js\nfoo()\n```\n1. Run it\nUse myFunc for results.';
      const result = scoreSkill(content, [], { detailed: true });
      assert.equal(typeof result.score, 'number');
      assert.equal(typeof result.specificity, 'number');
      assert.equal(typeof result.examples, 'number');
      assert.equal(typeof result.actionability, 'number');
      assert.equal(typeof result.source_reputation, 'number');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/penumbra/penumbraprojects/mcp-librarian && node --test test/test-quality-scorer.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement quality-scorer.js**

```js
// src/store/quality-scorer.js
/**
 * Heuristic quality scorer — 4 dimensions, zero dependencies.
 * Port of umbrav2's knowledge_quality.py scoring logic.
 */

import { scoreSource } from './source-reputation.js';

// Concrete token patterns: camelCase, snake_case, CLI flags, dotted paths
const CONCRETE_RE = /[a-z]+[A-Z]|_[a-z]|^--?[a-z]|\./;

// Imperative verbs at line starts
const IMPERATIVE_RE = /^(Run|Add|Create|Install|Set|Open|Copy|Move|Delete|Update|Enable|Disable|Configure|Build|Deploy|Start|Stop)\b/m;

const CONTENT_WEIGHT = 0.7;
const SOURCE_WEIGHT = 0.3;
const DEFAULT_SOURCE_REPUTATION = 0.5;

export function scoreSpecificity(content) {
  if (!content) return 0.0;
  const tokens = content.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return 0.0;
  const concrete = tokens.filter(t => CONCRETE_RE.test(t)).length;
  return Math.min(1.0, concrete / tokens.length * 2.5); // scale up — 40% concrete = 1.0
}

export function scoreExamples(content) {
  if (!content) return 0.0;
  const fencedBlocks = (content.match(/```/g) || []).length / 2; // pairs
  const inlineCode = (content.match(/`[^`]+`/g) || []).length;
  return Math.min(1.0, fencedBlocks * 0.15 + inlineCode * 0.03);
}

export function scoreActionability(content) {
  if (!content) return 0.0;
  const lines = content.split('\n');
  const numbered = lines.filter(l => /^\d+\.\s/.test(l.trim())).length;
  const imperatives = lines.filter(l => IMPERATIVE_RE.test(l.trim())).length;
  const commands = (content.match(/```(?:bash|sh|shell|zsh)\n/g) || []).length;
  return Math.min(1.0, numbered * 0.08 + imperatives * 0.06 + commands * 0.1);
}

export function scoreSkill(content, sources, opts = {}) {
  if (!content || content.trim().length === 0) return opts.detailed ? { score: 0.0, specificity: 0.0, examples: 0.0, actionability: 0.0, source_reputation: 0.0 } : 0.0;

  const specificity = scoreSpecificity(content);
  const examples = scoreExamples(content);
  const actionability = scoreActionability(content);

  // Source reputation: best of provided URLs, or default
  let sourceReputation = DEFAULT_SOURCE_REPUTATION;
  if (sources && sources.length > 0) {
    const scores = sources.map(u => scoreSource(u)).filter(s => s > 0);
    if (scores.length > 0) sourceReputation = Math.max(...scores);
  }

  const contentAvg = (specificity + examples + actionability) / 3;
  const score = Math.round((CONTENT_WEIGHT * contentAvg + SOURCE_WEIGHT * sourceReputation) * 10000) / 10000;

  if (opts.detailed) {
    return { score, specificity, examples, actionability, source_reputation: sourceReputation };
  }
  return score;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/penumbra/penumbraprojects/mcp-librarian && node --test test/test-quality-scorer.js`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/penumbra/penumbraprojects/mcp-librarian
git add src/store/quality-scorer.js test/test-quality-scorer.js
git commit -m "feat: add heuristic quality scorer — specificity, examples, actionability, source reputation"
```

---

### Task 4: Validator Extension (sources field)

**Files:**
- Modify: `src/librarian/validator.js:26-78`
- Modify: `test/test-parser.js` (or reuse existing validator test patterns)

- [ ] **Step 1: Write failing test**

Add to `test/test-parser.js`. First add the validator import at the top of the file:

```js
// Add this import to the top of test/test-parser.js
import { validateSkill } from '../src/librarian/validator.js';
```

Then add this describe block:

```js
describe('validator sources field', () => {
  it('accepts valid sources array', () => {
    const parsed = {
      frontmatter: { name: 'test', description: 'Test', sources: ['https://owasp.org'] },
      sections: [{ heading: 'Test', body: 'content', skill: 'test' }],
    };
    const result = validateSkill(parsed);
    assert.ok(result.valid);
  });

  it('rejects non-array sources', () => {
    const parsed = {
      frontmatter: { name: 'test', description: 'Test', sources: 'not an array' },
      sections: [{ heading: 'Test', body: 'content', skill: 'test' }],
    };
    const result = validateSkill(parsed);
    assert.ok(result.issues.some(i => i.message.includes('sources')));
  });

  it('rejects sources with more than 20 entries', () => {
    const parsed = {
      frontmatter: { name: 'test', description: 'Test', sources: Array(21).fill('https://example.com') },
      sections: [{ heading: 'Test', body: 'content', skill: 'test' }],
    };
    const result = validateSkill(parsed);
    assert.ok(result.issues.some(i => i.message.includes('20')));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/penumbra/penumbraprojects/mcp-librarian && node --test test/test-parser.js`
Expected: FAIL — no sources validation exists

- [ ] **Step 3: Add sources validation to validator.js**

In `src/librarian/validator.js`, after the domain validation block (line ~52), add:

```js
  // Validate sources if present
  if (parsed.frontmatter?.sources !== undefined) {
    const sources = parsed.frontmatter.sources;
    if (!Array.isArray(sources)) {
      issues.push({ severity: 'warning', message: 'Frontmatter sources must be an array of URL strings' });
    } else {
      if (sources.length > 20) {
        issues.push({ severity: 'warning', message: `Too many sources: ${sources.length} (max 20)` });
      }
      for (const s of sources) {
        if (typeof s !== 'string') {
          issues.push({ severity: 'warning', message: 'Each source must be a string' });
          break;
        }
      }
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/penumbra/penumbraprojects/mcp-librarian && node --test test/test-parser.js`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/penumbra/penumbraprojects/mcp-librarian
git add src/librarian/validator.js test/test-parser.js
git commit -m "feat: validate sources field in frontmatter — array of strings, max 20"
```

---

### Task 5: Manifest Quality Preservation in signAll()

**Files:**
- Modify: `src/librarian/integrity.js:54-61`

- [ ] **Step 1: Write failing test**

Add a new describe block to `test/test-integrity.js`. First add the needed imports at the top of the file:

```js
// Add these imports to the top of test/test-integrity.js
import { IntegrityEngine } from '../src/librarian/integrity.js';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
```

Then add this describe block after the existing one:

```js
describe('IntegrityEngine quality preservation', () => {
  const TMP = '/tmp/test-integrity-quality';
  let engine;

  beforeEach(() => {
    rmSync(TMP, { recursive: true, force: true });
    mkdirSync(TMP, { recursive: true });
    const { publicKey, privateKey } = generateKeypair();
    engine = new IntegrityEngine(TMP, publicKey, privateKey);
  });

  it('preserves quality scores when content hash is unchanged', () => {
    const contents = { 'test-skill': '---\nname: test\n---\n## Section\nContent.' };
    const manifest1 = engine.signAll(contents);

    manifest1.skills['test-skill'].quality = {
      score: 0.72, specificity: 0.8, examples: 0.7,
      actionability: 0.65, source_reputation: 0.6,
      scored_by: 'heuristic', scored_at: '2026-03-28T00:00:00Z',
    };
    engine.saveManifest(manifest1);

    const manifest2 = engine.signAll(contents);
    assert.ok(manifest2.skills['test-skill'].quality, 'Quality should be preserved');
    assert.equal(manifest2.skills['test-skill'].quality.score, 0.72);
  });

  it('drops quality scores when content hash changes', () => {
    const contents1 = { 'test-skill': '---\nname: test\n---\n## Section\nOriginal.' };
    const manifest1 = engine.signAll(contents1);
    manifest1.skills['test-skill'].quality = { score: 0.72, scored_by: 'heuristic' };
    engine.saveManifest(manifest1);

    const contents2 = { 'test-skill': '---\nname: test\n---\n## Section\nChanged.' };
    const manifest2 = engine.signAll(contents2);
    assert.equal(manifest2.skills['test-skill'].quality, undefined);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/penumbra/penumbraprojects/mcp-librarian && node --test test/test-integrity.js`
Expected: FAIL — quality is undefined after signAll

- [ ] **Step 3: Modify signAll() to preserve quality**

Replace `signAll` in `src/librarian/integrity.js`:

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

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/penumbra/penumbraprojects/mcp-librarian && node --test test/test-integrity.js`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/penumbra/penumbraprojects/mcp-librarian
git add src/librarian/integrity.js test/test-integrity.js
git commit -m "feat: preserve quality scores in signAll() when content hash unchanged"
```

---

### Task 6: Quality-Weighted BM25 Search

**Files:**
- Modify: `src/store/bm25.js:183-209` (`search` method)
- Modify: `src/store/skill-store.js` (attach quality to section meta)
- Create: `test/test-quality-retrieval.js`

- [ ] **Step 1: Write failing tests**

```js
// test/test-quality-retrieval.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BM25 } from '../src/store/bm25.js';

describe('quality-weighted retrieval', () => {
  it('ranks high-quality results above low-quality for same relevance', () => {
    const bm25 = new BM25();
    bm25.index([
      { heading: 'SQL injection', body: 'Use sqlmap for testing injection', skill: 'low-quality', quality: 0.3 },
      { heading: 'SQL injection', body: 'Use sqlmap for testing injection', skill: 'high-quality', quality: 0.9 },
    ]);
    const results = bm25.search('SQL injection', 2);
    assert.equal(results.length, 2);
    assert.equal(results[0].meta.skill, 'high-quality');
    assert.equal(results[1].meta.skill, 'low-quality');
  });

  it('returns empty for zero BM25 matches', () => {
    const bm25 = new BM25();
    bm25.index([
      { heading: 'React hooks', body: 'useState and useEffect', skill: 'frontend', quality: 0.8 },
    ]);
    const results = bm25.search('totally unrelated query xyz', 5);
    assert.equal(results.length, 0);
  });

  it('still respects BM25 relevance over quality when relevance differs significantly', () => {
    const bm25 = new BM25();
    bm25.index([
      { heading: 'Docker compose', body: 'docker compose up -d for running containers with docker', skill: 'docker', quality: 0.3 },
      { heading: 'React hooks', body: 'useState and useEffect for state', skill: 'react', quality: 0.9 },
    ]);
    const results = bm25.search('docker compose containers', 2);
    // Docker should win despite lower quality because BM25 relevance dominates
    assert.equal(results[0].meta.skill, 'docker');
  });

  it('uses default quality 0.5 when not provided', () => {
    const bm25 = new BM25();
    bm25.index([
      { heading: 'Test', body: 'some content', skill: 'no-quality' },
    ]);
    const results = bm25.search('content', 1);
    assert.equal(results.length, 1);
    // Should not crash — quality defaults to 0.5
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/penumbra/penumbraprojects/mcp-librarian && node --test test/test-quality-retrieval.js`
Expected: FAIL — quality not considered in ranking

- [ ] **Step 3: Modify chunkSection() to forward quality property**

In `src/store/bm25.js`, the `chunkSection()` function constructs new chunk objects with `{heading, body, skill, parentHeading}` but drops any extra properties like `quality`. Modify it to preserve `quality`:

In the two places where chunks are pushed (the sub-heading chunks and the paragraph-split chunks), add `quality: section.quality`:

```js
// In chunkSection(), wherever a new chunk object is created, add the quality field.
// Example — change each push to include quality:
chunks.push({
  heading: subHeading ? `${heading} > ${subHeading}` : heading,
  body: buf.trim(),
  skill,
  parentHeading: heading,
  quality: section.quality,
});
```

Apply this to ALL chunk object constructions in `chunkSection()` (there are 3 places: the two inside the large-chunk split loop, and the one for normal sub-chunks).

- [ ] **Step 4: Add quality blending to BM25.search()**

In `src/store/bm25.js`, modify the `search()` method:

```js
  search(query, topK = 5) {
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0 || this.docs.length === 0) return [];

    const scored = [];

    for (let i = 0; i < this.docs.length; i++) {
      const doc = this.docs[i];
      const dl = doc.tokens.length;
      let bm25Score = 0;

      for (const qt of queryTokens) {
        const idf = this.idf.get(qt) || 0;
        const f = doc.tf.get(qt) || 0;
        if (f === 0) continue;
        bm25Score += idf * (f * (K1 + 1)) / (f + K1 * (1 - B + B * dl / this.avgDl));
      }

      if (bm25Score > 0) {
        scored.push({ bm25Score, meta: doc.meta });
      }
    }

    if (scored.length === 0) return [];

    // Normalize BM25 to 0-1
    const maxBm25 = Math.max(...scored.map(s => s.bm25Score));
    for (const s of scored) {
      const normalizedBm25 = s.bm25Score / maxBm25;
      const quality = s.meta.quality ?? 0.5;
      s.score = normalizedBm25 * 0.6 + quality * 0.4;
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }
```

- [ ] **Step 5: Modify SkillStore.loadAll() to attach quality scores**

In `src/store/skill-store.js`, in the `loadAll()` method, after parsing each skill and before pushing sections, attach quality from manifest:

```js
  // Inside the for loop, after: this.skills.set(name, parsed);
  // Attach quality score to each section for BM25 blending
  const qualityScore = this.manifest?.skills?.[name]?.quality?.score ?? 0.5;
  for (const section of parsed.sections) {
    section.quality = qualityScore;
  }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd /Users/penumbra/penumbraprojects/mcp-librarian && node --test test/test-quality-retrieval.js`
Expected: All tests PASS

- [ ] **Step 7: Run all existing tests**

Run: `cd /Users/penumbra/penumbraprojects/mcp-librarian && node --test test/`
Expected: All tests PASS (no regressions)

- [ ] **Step 8: Commit**

```bash
cd /Users/penumbra/penumbraprojects/mcp-librarian
git add src/store/bm25.js src/store/skill-store.js test/test-quality-retrieval.js
git commit -m "feat: quality-weighted retrieval — blend BM25 relevance (60%) with quality score (40%)"
```

---

### Task 7: Enable/Disable Filtering

**Files:**
- Modify: `src/store/skill-store.js:31-63` (`loadAll`)
- Modify: `src/store/skill-store.js:119-131` (`listSkills`)
- Create: `test/test-skill-enable.js`

- [ ] **Step 1: Write failing tests**

```js
// test/test-skill-enable.js
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { SkillStore } from '../src/store/skill-store.js';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const TMP = '/tmp/test-skill-enable';

describe('skill enable/disable', () => {
  beforeEach(() => {
    rmSync(TMP, { recursive: true, force: true });
    mkdirSync(join(TMP, 'enabled-skill'), { recursive: true });
    mkdirSync(join(TMP, 'disabled-skill'), { recursive: true });

    writeFileSync(join(TMP, 'enabled-skill', 'SKILL.md'), `---
name: enabled-skill
description: "An enabled skill"
enabled: true
---

## Section
Enabled content.`);

    writeFileSync(join(TMP, 'disabled-skill', 'SKILL.md'), `---
name: disabled-skill
description: "A disabled skill"
enabled: false
---

## Section
Disabled content.`);
  });

  it('excludes disabled skills from BM25 index', () => {
    const store = new SkillStore(TMP);
    store.loadAll();
    assert.equal(store.skills.size, 2); // both loaded
    // Search should only find the enabled skill
    const results = store.search('content', 10);
    const skillNames = results.map(r => r.meta.skill);
    assert.ok(skillNames.includes('enabled-skill'));
    assert.ok(!skillNames.includes('disabled-skill'));
  });

  it('shows disabled skills in listSkills with enabled=false', () => {
    const store = new SkillStore(TMP);
    store.loadAll();
    const list = store.listSkills();
    assert.equal(list.length, 2);
    const disabled = list.find(s => s.name === 'disabled-skill');
    assert.strictEqual(disabled.enabled, false);
    const enabled = list.find(s => s.name === 'enabled-skill');
    assert.strictEqual(enabled.enabled, true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/penumbra/penumbraprojects/mcp-librarian && node --test test/test-skill-enable.js`
Expected: FAIL — disabled skills appear in search, no enabled field in listSkills

- [ ] **Step 3: Modify loadAll() to filter disabled skills from index**

In `src/store/skill-store.js`, in `loadAll()`, change the section collection:

```js
  // Replace: allSections.push(...parsed.sections);
  // With:
  if (parsed.frontmatter.enabled !== false) {
    allSections.push(...parsed.sections);
  }
```

- [ ] **Step 4: Fix rebuildIndex() to also filter disabled skills**

In `src/store/skill-store.js`, modify `rebuildIndex()`:

```js
  rebuildIndex() {
    const allSections = [];
    for (const parsed of this.skills.values()) {
      if (parsed.frontmatter.enabled !== false) {
        allSections.push(...parsed.sections);
      }
    }
    this.bm25.index(allSections);
  }
```

- [ ] **Step 5: Extend listSkills() with enabled and quality fields**

In `src/store/skill-store.js`, in `listSkills()`:

```js
  listSkills() {
    const result = [];
    for (const [name, parsed] of this.skills) {
      const qualityEntry = this.manifest?.skills?.[name]?.quality;
      result.push({
        name,
        description: parsed.frontmatter.description || '',
        domain: parsed.frontmatter.domain || 'general',
        sections: extractSectionHeadings(parsed),
        status: this.verifySkill(name).status,
        enabled: parsed.frontmatter.enabled !== false,
        quality: qualityEntry?.score ?? null,
      });
    }
    return result;
  }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd /Users/penumbra/penumbraprojects/mcp-librarian && node --test test/test-skill-enable.js`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
cd /Users/penumbra/penumbraprojects/mcp-librarian
git add src/store/skill-store.js test/test-skill-enable.js
git commit -m "feat: skill enable/disable — filter disabled from index, show in list"
```

---

### Task 8: Expertise Summary + Status Integration

**Files:**
- Modify: `src/store/skill-store.js` (add `buildExpertiseSummary()`)
- Modify: `src/librarian/index.js:171-179` (`getStatus()`)
- Modify: `src/tools/librarian-status.js`

- [ ] **Step 1: Add buildExpertiseSummary() to SkillStore**

```js
  // Add to src/store/skill-store.js
  buildExpertiseSummary() {
    const enabled = this.listSkills().filter(s => s.enabled);
    if (enabled.length === 0) return '';

    const lines = ['KNOWLEDGE AVAILABLE:', ''];
    for (const s of enabled) {
      const sectionCount = s.sections.length;
      lines.push(`- [${s.domain}] ${s.name}: ${s.description} (${sectionCount} sections)`);
    }
    lines.push('', 'Use find_skill("query") to retrieve specific knowledge.');
    return lines.join('\n');
  }
```

- [ ] **Step 2: Add expertiseSummary to getStatus() in index.js**

In `src/librarian/index.js`, modify `getStatus()`:

```js
  getStatus() {
    return {
      lastRun: this.lastRun,
      issues: this.issues,
      staging: this.staging.list(),
      skillCount: this.store.skills.size,
      indexedChunks: this.store.bm25.documentCount,
      expertiseSummary: this.store.buildExpertiseSummary(),
    };
  }
```

- [ ] **Step 3: Update librarian-status tool to format expertise summary**

In `src/tools/librarian-status.js`:

```js
export function handler(librarian) {
  return () => {
    const status = librarian.getStatus();
    // Append expertise summary as readable text if present
    if (status.expertiseSummary) {
      status.expertiseSummaryText = status.expertiseSummary;
    }
    return status;
  };
}
```

- [ ] **Step 4: Run all tests**

Run: `cd /Users/penumbra/penumbraprojects/mcp-librarian && node --test test/`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/penumbra/penumbraprojects/mcp-librarian
git add src/store/skill-store.js src/librarian/index.js src/tools/librarian-status.js
git commit -m "feat: expertise summary — model sees available knowledge via librarian_status"
```

---

### Task 9: Tool Output Updates (find-skill, list-skills)

**Files:**
- Modify: `src/tools/find-skill.js:55-77`
- Modify: `src/tools/list-skills.js:17-31`

- [ ] **Step 1: Update find-skill.js output**

In `src/tools/find-skill.js`, change the relevance display (around line 64):

```js
      // Replace:
      // lines.push(`_Relevance: ${Math.round(r.score * 100) / 100}_\n`);
      // With:
      const quality = r.meta.quality ?? 0.5;
      lines.push(`_Relevance: ${Math.round(r.score * 100) / 100} | Quality: ${Math.round(quality * 100) / 100}_\n`);
```

- [ ] **Step 2: Update list-skills.js output**

In `src/tools/list-skills.js`, update the formatting loop:

```js
    for (const s of skills) {
      const domain = s.domain || 'general';
      const disabledTag = s.enabled === false ? ' [disabled]' : '';
      const qualityTag = s.quality != null ? ` (q:${Math.round(s.quality * 100) / 100})` : '';
      lines.push(`- **[${domain}] ${s.name}**${disabledTag}${qualityTag}: ${s.description}`);
      if (s.sections.length > 0) {
        lines.push(`  Sections: ${s.sections.join(', ')}`);
      }
    }
```

- [ ] **Step 3: Run all tests**

Run: `cd /Users/penumbra/penumbraprojects/mcp-librarian && node --test test/`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
cd /Users/penumbra/penumbraprojects/mcp-librarian
git add src/tools/find-skill.js src/tools/list-skills.js
git commit -m "feat: show quality scores in find_skill and list_skills output"
```

---

### Task 10: Heuristic Scoring in Maintenance Cycle

**Files:**
- Modify: `src/librarian/index.js:47-89` (`runMaintenance`)

- [ ] **Step 1: Import quality scorer**

Add to top of `src/librarian/index.js`:

```js
import { scoreSkill } from '../store/quality-scorer.js';
```

- [ ] **Step 2: Add heuristic scoring pass to runMaintenance()**

After the `// Rebuild store index` comment and `this.store.loadAll()` call, add:

```js
      // Heuristic quality scoring pass
      const manifest = this.integrity.loadManifest();
      let scoredCount = 0;
      for (const [name, { content, parsed }] of Object.entries(skills)) {
        const entry = manifest.skills?.[name];
        if (!entry) continue;

        // Skip if already scored and content unchanged
        if (entry.quality && entry.sha256 === entry.quality?._forHash) continue;

        const sources = parsed.frontmatter?.sources || [];
        const detailed = scoreSkill(content, sources, { detailed: true });
        entry.quality = {
          ...detailed,
          scored_by: 'heuristic',
          scored_at: new Date().toISOString(),
          _forHash: entry.sha256,
        };
        scoredCount++;
      }
      if (scoredCount > 0) {
        this.integrity.saveManifest(manifest);
        // Reload store to pick up new quality scores
        this.store.loadAll();
      }
```

- [ ] **Step 3: Run all tests**

Run: `cd /Users/penumbra/penumbraprojects/mcp-librarian && node --test test/`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
cd /Users/penumbra/penumbraprojects/mcp-librarian
git add src/librarian/index.js
git commit -m "feat: heuristic quality scoring during maintenance cycle"
```

---

### Task 11: LLM Quality Scoring (optional Ollama)

**Files:**
- Modify: `src/librarian/ai-curator.js` (add `scoreSkillsWithLLM`)
- Modify: `src/librarian/index.js` (async LLM pass after heuristic)

- [ ] **Step 1: Add scoreSkillsWithLLM to ai-curator.js**

```js
// Add to src/librarian/ai-curator.js

const QUALITY_SYSTEM = `You are a knowledge quality reviewer. Score each skill on three dimensions (0.0 to 1.0):
- specificity: concrete APIs, parameters, patterns (1.0) vs vague generalities (0.0)
- examples: rich code snippets and usage examples (1.0) vs no examples (0.0)
- actionability: copy-paste ready (1.0) vs pure background/theory (0.0)

Respond with JSON only:
{"scores": [{"id": "skill_name", "specificity": 0.8, "examples": 0.6, "actionability": 0.9}]}`;

export async function scoreSkillsWithLLM(skills) {
  const simplified = skills.map(s => ({
    id: s.name,
    description: s.description?.slice(0, 100) || '',
    sample: s.content?.slice(0, 500) || '',
  }));

  const prompt = `Score the following skills:\n\n${JSON.stringify(simplified, null, 2)}`;

  try {
    const resp = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        prompt,
        system: QUALITY_SYSTEM,
        stream: false,
        options: { temperature: 0.1, num_predict: 1024 },
      }),
    });

    if (!resp.ok) return null;
    const data = await resp.json();
    let output = sanitizeAIOutput(data.response || '');

    // Strip markdown fences
    output = output.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '').trim();

    const parsed = JSON.parse(output);
    if (parsed?.scores && Array.isArray(parsed.scores)) {
      return parsed.scores;
    }
    return null;
  } catch {
    return null; // Ollama unavailable or parse error — fail silently
  }
}
```

- [ ] **Step 2: Add async LLM pass to maintenance in index.js**

After the heuristic scoring block in `runMaintenance()`, add:

```js
      // Async LLM scoring upgrade (non-blocking, best-effort)
      this._runLLMScoring(skills, manifest).catch(() => {});
```

Add new method to Librarian class:

```js
  async _runLLMScoring(skills, manifest) {
    const needsLLM = [];
    for (const [name, { content, parsed }] of Object.entries(skills)) {
      const entry = manifest.skills?.[name];
      if (entry?.quality?.scored_by === 'heuristic') {
        needsLLM.push({ name, content, description: parsed.frontmatter?.description });
      }
    }
    if (needsLLM.length === 0) return;

    // Process in batches of 5
    for (let i = 0; i < needsLLM.length; i += 5) {
      const batch = needsLLM.slice(i, i + 5);
      const scores = await ai.scoreSkillsWithLLM(batch);
      if (!scores) continue;

      const reloadManifest = this.integrity.loadManifest();
      for (const s of scores) {
        const entry = reloadManifest.skills?.[s.id];
        if (!entry?.quality) continue;
        const spec = parseFloat(s.specificity);
        const ex = parseFloat(s.examples);
        const act = parseFloat(s.actionability);
        if ([spec, ex, act].some(v => isNaN(v) || v < 0 || v > 1)) continue;

        const srcRep = entry.quality.source_reputation ?? 0.5;
        entry.quality.specificity = spec;
        entry.quality.examples = ex;
        entry.quality.actionability = act;
        entry.quality.score = Math.round((0.7 * (spec + ex + act) / 3 + 0.3 * srcRep) * 10000) / 10000;
        entry.quality.scored_by = 'llm';
        entry.quality.scored_at = new Date().toISOString();
      }
      this.integrity.saveManifest(reloadManifest);
    }

    // Reload store with LLM-upgraded scores
    this.store.loadAll();
  }
```

- [ ] **Step 3: Run all tests**

Run: `cd /Users/penumbra/penumbraprojects/mcp-librarian && node --test test/`
Expected: All tests PASS (LLM scoring is best-effort, doesn't affect existing behavior)

- [ ] **Step 4: Commit**

```bash
cd /Users/penumbra/penumbraprojects/mcp-librarian
git add src/librarian/ai-curator.js src/librarian/index.js
git commit -m "feat: optional LLM quality scoring via Ollama — upgrades heuristic scores in batches of 5"
```

---

### Task 12: Update draftSkill Prompt for Sources

**Files:**
- Modify: `src/librarian/ai-curator.js:114-129` (`draftSkill`)

- [ ] **Step 1: Update the draftSkill prompt**

In `src/librarian/ai-curator.js`, modify the `draftSkill` function prompt:

```js
export async function draftSkill(topic, existingSkills) {
  const prompt = `Draft a new SKILL.md file for the topic: "${topic}"

Existing skills for context: ${existingSkills.join(', ')}

Requirements:
- YAML frontmatter with name, description, domain, version
- Include a sources field with comma-separated authoritative URLs you referenced, e.g.: sources: "https://docs.example.com, https://rfc-editor.org/..."
- 3-8 sections with ## headings
- Each section: 50-300 tokens, self-contained, practical
- Focus on patterns and examples, not theory
- Target audience: AI coding assistants

Output the complete SKILL.md content:`;

  return callOllama(prompt);
}
```

- [ ] **Step 2: Run all tests**

Run: `cd /Users/penumbra/penumbraprojects/mcp-librarian && node --test test/`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
cd /Users/penumbra/penumbraprojects/mcp-librarian
git add src/librarian/ai-curator.js
git commit -m "feat: draftSkill prompt now requests source URLs in frontmatter"
```

---

### Task 13: Final Integration Test + Full Test Run

**Files:**
- All test files

- [ ] **Step 1: Run complete test suite**

Run: `cd /Users/penumbra/penumbraprojects/mcp-librarian && node --test test/`
Expected: All tests PASS, zero regressions

- [ ] **Step 2: Manual smoke test with real skills**

Run: `cd /Users/penumbra/penumbraprojects/mcp-librarian && node -e "
import { SkillStore } from './src/store/skill-store.js';
const store = new SkillStore('./skills');
store.loadAll();
console.log('Skills loaded:', store.skills.size);
console.log('Index chunks:', store.bm25.documentCount);
console.log('List:', store.listSkills().map(s => s.name + ' q:' + s.quality));
console.log('Summary:', store.buildExpertiseSummary());
const results = store.search('SQL injection', 3);
console.log('Search results:', results.map(r => r.meta.skill + ' score:' + r.score));
"`
Expected: Skills load, quality scores show, search returns ranked results

- [ ] **Step 3: Commit any final fixes**

```bash
cd /Users/penumbra/penumbraprojects/mcp-librarian
git add -A
git commit -m "test: final integration verification — all quality-weighted retrieval features working"
```
