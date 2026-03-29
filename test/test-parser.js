import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSkill, extractSectionHeadings } from '../src/store/parser.js';
import { validateSkill } from '../src/librarian/validator.js';

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

  it('should block prototype pollution via __proto__', () => {
    const poisoned = `---
__proto__: polluted
constructor: evil
name: safe
---

## Test

Content.
`;
    const result = parseSkill(poisoned, 'test');
    assert.equal(result.frontmatter.__proto__, undefined);
    assert.equal(result.frontmatter.constructor, undefined);
    assert.equal(result.frontmatter.name, 'safe');
    // Verify no pollution of Object.prototype
    assert.equal(({}).polluted, undefined);
  });
});

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
    assert.deepEqual(result.frontmatter.sources, ['https://owasp.org', 'https://portswigger.net']);
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
