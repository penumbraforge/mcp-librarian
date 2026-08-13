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
