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
