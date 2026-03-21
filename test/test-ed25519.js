import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdir, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  generateKeypair,
  signSkill,
  verifySkill,
  loadManifest,
  saveManifest,
  signAllSkills,
} from '../src/security/ed25519.js';

describe('ed25519', () => {
  let testDir;

  beforeEach(async () => {
    testDir = join(tmpdir(), `mcp-librarian-ed25519-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  // 1. generateKeypair
  it('generateKeypair returns publicKey and privateKey as PEM strings', () => {
    const { publicKey, privateKey } = generateKeypair();
    assert.equal(typeof publicKey, 'string');
    assert.equal(typeof privateKey, 'string');
    assert.ok(publicKey.includes('-----BEGIN PUBLIC KEY-----'), 'publicKey should be SPKI PEM');
    assert.ok(privateKey.includes('-----BEGIN PRIVATE KEY-----'), 'privateKey should be PKCS8 PEM');
  });

  // 2. signSkill
  it('signSkill returns { hash, signature, signedAt } with correct formats', async () => {
    const { privateKey } = generateKeypair();
    const content = 'some skill content here';
    const result = await signSkill(content, privateKey);

    assert.ok('hash' in result, 'result should have hash');
    assert.ok('signature' in result, 'result should have signature');
    assert.ok('signedAt' in result, 'result should have signedAt');

    // hash is 64-char SHA-256 hex
    assert.equal(typeof result.hash, 'string');
    assert.equal(result.hash.length, 64);
    assert.ok(/^[0-9a-f]+$/.test(result.hash), 'hash should be lowercase hex');

    // signature is base64
    assert.equal(typeof result.signature, 'string');
    assert.ok(result.signature.length > 0, 'signature should not be empty');
    const decoded = Buffer.from(result.signature, 'base64');
    assert.ok(decoded.length > 0, 'signature base64 should decode to bytes');

    // signedAt is an ISO string
    assert.equal(typeof result.signedAt, 'string');
    assert.doesNotThrow(() => new Date(result.signedAt));
  });

  // 3. verifySkill with valid signature — VERIFIED
  it('verifySkill returns VERIFIED for valid content and signature', async () => {
    const { publicKey, privateKey } = generateKeypair();
    const content = 'the skill content to verify';
    const entry = await signSkill(content, privateKey);
    const result = await verifySkill(content, entry, publicKey);
    assert.equal(result, 'VERIFIED');
  });

  // 4. verifySkill with tampered content — TAMPERED
  it('verifySkill returns TAMPERED when content has been modified', async () => {
    const { publicKey, privateKey } = generateKeypair();
    const content = 'original skill content';
    const entry = await signSkill(content, privateKey);
    const result = await verifySkill('tampered skill content', entry, publicKey);
    assert.equal(result, 'TAMPERED');
  });

  // 4b. verifySkill with bad signature — TAMPERED
  it('verifySkill returns TAMPERED when signature is invalid', async () => {
    const { publicKey, privateKey } = generateKeypair();
    const content = 'skill content';
    const entry = await signSkill(content, privateKey);
    const tampered = { ...entry, signature: Buffer.from('not-a-valid-sig').toString('base64') };
    const result = await verifySkill(content, tampered, publicKey);
    assert.equal(result, 'TAMPERED');
  });

  // 5. verifySkill with null entry — UNSIGNED
  it('verifySkill returns UNSIGNED when entry is null', async () => {
    const { publicKey } = generateKeypair();
    const result = await verifySkill('any content', null, publicKey);
    assert.equal(result, 'UNSIGNED');
  });

  it('verifySkill returns UNSIGNED when entry is undefined', async () => {
    const { publicKey } = generateKeypair();
    const result = await verifySkill('any content', undefined, publicKey);
    assert.equal(result, 'UNSIGNED');
  });

  // 6. loadManifest on nonexistent file — returns skeleton
  it('loadManifest returns skeleton manifest when file does not exist', async () => {
    const manifestPath = join(testDir, 'manifest.json');
    const manifest = await loadManifest(manifestPath);
    assert.deepEqual(manifest, { version: 1, signedAt: null, skills: {} });
  });

  // 7. loadManifest on valid file — returns parsed content
  it('loadManifest returns parsed content from existing manifest file', async () => {
    const manifestPath = join(testDir, 'manifest.json');
    const data = {
      version: 1,
      signedAt: '2026-03-21T08:00:00.000Z',
      skills: {
        'test-skill': {
          hash: 'abc123',
          signature: 'sig456',
          signedAt: '2026-03-21T08:00:00.000Z',
        },
      },
    };
    await writeFile(manifestPath, JSON.stringify(data));
    const manifest = await loadManifest(manifestPath);
    assert.deepEqual(manifest, data);
  });

  // 8. saveManifest writes atomically
  it('saveManifest writes manifest file atomically', async () => {
    const manifestPath = join(testDir, 'manifest.json');
    const manifest = {
      version: 1,
      signedAt: '2026-03-21T08:00:00.000Z',
      skills: {},
    };
    await saveManifest(manifestPath, manifest);

    // File should exist and contain the right content
    const raw = await readFile(manifestPath, 'utf8');
    const parsed = JSON.parse(raw);
    assert.deepEqual(parsed, manifest);

    // The .tmp file should have been cleaned up
    let tmpExists = false;
    try {
      await readFile(manifestPath + '.tmp', 'utf8');
      tmpExists = true;
    } catch {
      tmpExists = false;
    }
    assert.equal(tmpExists, false, '.tmp file should be gone after atomic write');
  });

  // 9. signAllSkills — signs all .md files and writes manifest
  it('signAllSkills signs all skill files and writes manifest with entries', async () => {
    const { publicKey, privateKey } = generateKeypair();
    const skillsDir = join(testDir, 'skills');
    await mkdir(skillsDir, { recursive: true });

    // Create two test skill files with frontmatter
    const skill1Content = `---\nname: fetch-weather\ndescription: Fetch weather data\n---\n\nFetch current weather for a location.\n`;
    const skill2Content = `---\nname: write-file\ndescription: Write content to a file\n---\n\nWrite text content to a file.\n`;

    await writeFile(join(skillsDir, 'fetch-weather.md'), skill1Content);
    await writeFile(join(skillsDir, 'write-file.md'), skill2Content);

    const manifestPath = join(testDir, 'manifest.json');

    await signAllSkills({ home: testDir, privateKey });

    // Manifest should exist
    const raw = await readFile(manifestPath, 'utf8');
    const manifest = JSON.parse(raw);

    assert.equal(manifest.version, 1);
    assert.ok(manifest.signedAt, 'manifest should have a signedAt timestamp');
    assert.ok('fetch-weather' in manifest.skills, 'manifest should include fetch-weather');
    assert.ok('write-file' in manifest.skills, 'manifest should include write-file');

    for (const [, entry] of Object.entries(manifest.skills)) {
      assert.ok(entry.hash, 'entry should have hash');
      assert.ok(entry.signature, 'entry should have signature');
      assert.ok(entry.signedAt, 'entry should have signedAt');
      assert.equal(entry.hash.length, 64, 'hash should be 64 chars');
    }

    // Verify the signatures are valid
    const verified1 = await verifySkill(skill1Content, manifest.skills['fetch-weather'], publicKey);
    const verified2 = await verifySkill(skill2Content, manifest.skills['write-file'], publicKey);
    assert.equal(verified1, 'VERIFIED');
    assert.equal(verified2, 'VERIFIED');
  });
});
