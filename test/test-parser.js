import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSkill, extractSectionHeadings } from '../src/store/parser.js';

describe('Parser', () => {
  const sample = `---
name: test-skill
description: A test skill
---

## Section One

Content for section one.

## Section Two

Content for section two with code:
\`\`\`js
console.log("hello");
\`\`\`

## Third Section

More content here.
`;

  it('should parse frontmatter', () => {
    const result = parseSkill(sample, 'test');
    assert.equal(result.frontmatter.name, 'test-skill');
    assert.equal(result.frontmatter.description, 'A test skill');
  });

  it('should parse sections', () => {
    const result = parseSkill(sample, 'test');
    const headings = extractSectionHeadings(result);
    assert.deepEqual(headings, ['Section One', 'Section Two', 'Third Section']);
  });

  it('should preserve section content', () => {
    const result = parseSkill(sample, 'test');
    const s2 = result.sections.find(s => s.heading === 'Section Two');
    assert.ok(s2.body.includes('console.log'));
  });

  it('should handle content without frontmatter', () => {
    const noFm = '## Just Content\n\nSome text here.';
    const result = parseSkill(noFm, 'test');
    assert.deepEqual(result.frontmatter, {});
    assert.equal(result.sections.length, 1);
  });

  it('should set skill name on sections', () => {
    const result = parseSkill(sample, 'myskill');
    for (const s of result.sections) {
      assert.equal(s.skill, 'myskill');
    }
  });
});
