import { generateKeyPairSync, sign, verify, createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

export function generateKeypair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKey, privateKey };
}

export function saveKeypair(pubPath, privPath) {
  const { publicKey, privateKey } = generateKeypair();
  writeFileSync(pubPath, publicKey, { mode: 0o600 });
  writeFileSync(privPath, privateKey, { mode: 0o600 });
  return { publicKey, privateKey };
}

export function loadPublicKey(path) {
  return readFileSync(path, 'utf8');
}

export function loadPrivateKey(path) {
  return readFileSync(path, 'utf8');
}

export function signContent(content, privateKeyPem) {
  const sig = sign(null, Buffer.from(content), privateKeyPem);
  return sig.toString('base64');
}

export function verifySignature(content, signatureB64, publicKeyPem) {
  try {
    return verify(null, Buffer.from(content), publicKeyPem, Buffer.from(signatureB64, 'base64'));
  } catch {
    return false;
  }
}

export function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}
