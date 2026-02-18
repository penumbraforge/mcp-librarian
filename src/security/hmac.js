import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const NONCE_BYTES = 32;
const AUTH_TIMEOUT_MS = 5000;

export function generateNonce() {
  return randomBytes(NONCE_BYTES);
}

export function computeHmac(secret, nonce) {
  return createHmac('sha256', secret).update(nonce).digest();
}

export function verifyHmac(secret, nonce, responseHex) {
  const expected = computeHmac(secret, nonce);
  const received = Buffer.from(responseHex, 'hex');
  if (expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
}

export function createChallenge() {
  const nonce = generateNonce();
  return {
    nonce,
    nonceHex: nonce.toString('hex'),
    createdAt: Date.now(),
  };
}

export function isChallengeExpired(challenge) {
  return Date.now() - challenge.createdAt > AUTH_TIMEOUT_MS;
}
