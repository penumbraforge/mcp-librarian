import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeypair, signContent, verifySignature, sha256 } from '../src/security/ed25519.js';

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
