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
    assert.equal(store.skills.size, 2);
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
