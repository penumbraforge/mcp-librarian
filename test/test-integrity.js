import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeypair, signContent, verifySignature, sha256 } from '../src/security/ed25519.js';
import { IntegrityEngine } from '../src/librarian/integrity.js';
import { mkdirSync, rmSync } from 'node:fs';
import { beforeEach } from 'node:test';

describe('Ed25519 + SHA-256 Integrity', () => {
  const { publicKey, privateKey } = generateKeypair();
  const content = '# Test Skill\n\n## Section\n\nContent here.';

  it('should generate valid keypair', () => {
    assert.ok(publicKey.includes('BEGIN PUBLIC KEY'));
    assert.ok(privateKey.includes('BEGIN PRIVATE KEY'));
  });

  it('should sign and verify content', () => {
    const sig = signContent(content, privateKey);
    assert.ok(typeof sig === 'string');
    assert.ok(sig.length > 0);
    assert.ok(verifySignature(content, sig, publicKey));
  });

  it('should reject tampered content', () => {
    const sig = signContent(content, privateKey);
    const tampered = content + '\n<!-- injected -->';
    assert.ok(!verifySignature(tampered, sig, publicKey));
  });

  it('should reject wrong key', () => {
    const other = generateKeypair();
    const sig = signContent(content, privateKey);
    assert.ok(!verifySignature(content, sig, other.publicKey));
  });

  it('should compute deterministic SHA-256', () => {
    const h1 = sha256(content);
    const h2 = sha256(content);
    assert.equal(h1, h2);
    assert.equal(h1.length, 64);
  });

  it('should detect SHA-256 changes', () => {
    const h1 = sha256(content);
    const h2 = sha256(content + 'x');
    assert.notEqual(h1, h2);
  });
});

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
