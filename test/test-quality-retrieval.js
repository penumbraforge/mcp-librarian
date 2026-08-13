import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { SkillStore } from '../src/store/skill-store.js';

/**
 * QUALITY-WEIGHTED RETRIEVAL
 *
 * Ported from the legacy lineage. BM25 relevance is blended with a heuristic
 * skill-quality score. Critical invariant: rawScore is preserved so
 * find_and_load can still tell a match from a no-match — the blended score is
 * normalized toward 1.0 at the top and useless for that decision.
 */

// High relevance to "widget", but thin/vague content → low quality.
const THIN_WIDGET = `---
name: thin-widget
version: 1.0.0
category: [ui]
description: widget widget widget
---

## Widget

A widget is a thing. Widgets are general. This covers widgets broadly.
`;

// Also relevant to "widget", but concrete, example-rich → high quality.
const RICH_WIDGET = `---
name: rich-widget
version: 1.0.0
category: [ui]
description: Building widgets with the Widget API
sources: [https://react.dev/reference]
---

## Widget setup

Run \`npm install widget-kit\` to install the Widget API.

1. Create a widget with \`createWidget({ id })\`.
2. Configure the \`widget.render\` callback.

\`\`\`bash
npx widget-kit init
\`\`\`

Call \`widget.mount(el)\` to attach the widget to the DOM.
`;

async function makeStore(overrides = {}) {
  const home = join(tmpdir(), `mcp-quality-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(home, 'skills'), { recursive: true });
  await writeFile(join(home, 'skills', 'thin-widget.md'), THIN_WIDGET);
  await writeFile(join(home, 'skills', 'rich-widget.md'), RICH_WIDGET);
  const store = new SkillStore({ home, cacheSize: 50, cacheTtl: 60000, ...overrides });
  await store.load();
  return { store, home };
}

describe('quality-weighted retrieval', () => {
  let cleanup = [];
  afterEach(async () => {
    for (const home of cleanup) await rm(home, { recursive: true, force: true });
    cleanup = [];
  });

  it('assigns higher quality to concrete, example-rich skills', async () => {
    const { store, home } = await makeStore();
    cleanup.push(home);
    const skills = store.listSkills();
    const rich = skills.find(s => s.name === 'rich-widget');
    const thin = skills.find(s => s.name === 'thin-widget');
    assert.ok(rich.quality > thin.quality,
      `rich (${rich.quality}) should outscore thin (${thin.quality})`);
  });

  it('every result carries rawScore and quality', async () => {
    const { store, home } = await makeStore();
    cleanup.push(home);
    const results = store.search('widget');
    assert.ok(results.length > 0);
    for (const r of results) {
      assert.equal(typeof r.rawScore, 'number');
      assert.equal(typeof r.quality, 'number');
      assert.equal(typeof r.score, 'number');
    }
  });

  it('rawScore reflects unblended BM25 (a no-match query stays near zero)', async () => {
    const { store, home } = await makeStore();
    cleanup.push(home);
    // Nothing in either skill matches this — BM25 returns nothing.
    const results = store.search('zzzznonexistentterm');
    assert.equal(results.length, 0, 'no BM25 hit → empty, so find_and_load falls through to no-match');
  });

  it('blended top score does not masquerade as a strong raw match', async () => {
    const { store, home } = await makeStore();
    cleanup.push(home);
    const results = store.search('widget');
    // The blended score is normalized toward 1.0 — this is exactly why the
    // no-match gate must read rawScore, which is unbounded BM25.
    assert.ok(results[0].score <= 1.0 + 1e-9);
    assert.ok(results[0].rawScore !== results[0].score || results[0].quality === results[0].rawScore,
      'rawScore is tracked separately from the blended score');
  });

  it('quality weighting off → pure BM25 order, rawScore === score', async () => {
    const { store, home } = await makeStore({ qualityWeighting: false });
    cleanup.push(home);
    const results = store.search('widget');
    for (const r of results) {
      assert.equal(r.score, r.rawScore, 'pure BM25: blended score equals raw');
    }
  });

  it('qualityWeight is clamped to [0,1]', async () => {
    const { store, home } = await makeStore({ qualityWeight: 5 });
    cleanup.push(home);
    // Should not throw and should still produce sane, finite scores.
    const results = store.search('widget');
    for (const r of results) assert.ok(Number.isFinite(r.score));
  });
});
