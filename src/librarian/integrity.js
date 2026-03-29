/**
 * Ed25519 signature + SHA-256 manifest management.
 */

import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { sha256, signContent, verifySignature } from '../security/ed25519.js';

export class IntegrityEngine {
  constructor(skillsDir, publicKey, privateKey) {
    this.skillsDir = skillsDir;
    this.manifestPath = join(skillsDir, 'manifest.json');
    this.publicKey = publicKey;
    this.privateKey = privateKey;
  }

  loadManifest() {
    if (!existsSync(this.manifestPath)) {
      return { skills: {}, signedAt: null };
    }
    return JSON.parse(readFileSync(this.manifestPath, 'utf8'));
  }

  saveManifest(manifest) {
    // Atomic write: tmp → rename
    const tmp = this.manifestPath + '.tmp';
    writeFileSync(tmp, JSON.stringify(manifest, null, 2), { mode: 0o644 });
    renameSync(tmp, this.manifestPath);
  }

  signSkill(name, content) {
    const hash = sha256(content);
    const signature = this.privateKey ? signContent(content, this.privateKey) : null;
    return { sha256: hash, signature, signedAt: new Date().toISOString() };
  }

  verifySkill(name, content, manifest) {
    const entry = manifest?.skills?.[name];
    if (!entry) return { status: 'UNSIGNED' };

    const actualHash = sha256(content);
    if (actualHash !== entry.sha256) {
      return { status: 'TAMPERED', expected: entry.sha256, actual: actualHash };
    }

    if (this.publicKey && entry.signature) {
      const valid = verifySignature(content, entry.signature, this.publicKey);
      if (!valid) return { status: 'TAMPERED', reason: 'signature_invalid' };
    }

    return { status: 'VERIFIED', sha256: actualHash };
  }

  signAll(skillContents) {
    const existing = this.loadManifest();
    const manifest = { skills: {}, signedAt: new Date().toISOString() };
    for (const [name, content] of Object.entries(skillContents)) {
      manifest.skills[name] = this.signSkill(name, content);
      // Preserve quality scores if content hash unchanged
      if (existing.skills?.[name]?.quality &&
          existing.skills[name].sha256 === manifest.skills[name].sha256) {
        manifest.skills[name].quality = existing.skills[name].quality;
      }
    }
    this.saveManifest(manifest);
    return manifest;
  }
}
