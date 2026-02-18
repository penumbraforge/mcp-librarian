import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createChallenge, isChallengeExpired, computeHmac, verifyHmac } from '../src/security/hmac.js';

describe('HMAC Auth', () => {
  const secret = 'test-secret-key-for-unit-tests';

  it('should generate unique nonces', () => {
    const c1 = createChallenge();
    const c2 = createChallenge();
    assert.notEqual(c1.nonceHex, c2.nonceHex);
    assert.equal(c1.nonceHex.length, 64); // 32 bytes = 64 hex
  });

  it('should verify correct HMAC', () => {
    const challenge = createChallenge();
    const hmac = computeHmac(secret, challenge.nonce);
    assert.ok(verifyHmac(secret, challenge.nonce, hmac.toString('hex')));
  });

  it('should reject wrong HMAC', () => {
    const challenge = createChallenge();
    assert.ok(!verifyHmac(secret, challenge.nonce, 'deadbeef'.repeat(8)));
  });

  it('should reject wrong secret', () => {
    const challenge = createChallenge();
    const hmac = computeHmac('wrong-secret', challenge.nonce);
    assert.ok(!verifyHmac(secret, challenge.nonce, hmac.toString('hex')));
  });

  it('should detect expired challenges', async () => {
    const challenge = createChallenge();
    // Not expired immediately
    assert.ok(!isChallengeExpired(challenge));
    // Mutate createdAt to simulate expiry
    challenge.createdAt = Date.now() - 6000;
    assert.ok(isChallengeExpired(challenge));
  });
});
