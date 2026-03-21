/**
 * Ed25519 signing module for skill integrity verification.
 *
 * All functions are async except generateKeypair(), which is sync
 * because it is only called at install time.
 */

import { generateKeyPairSync, createHash, sign, verify } from 'node:crypto';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Key generation (sync — install-time only)
// ---------------------------------------------------------------------------

/**
 * Generate an Ed25519 keypair.
 * @returns {{ publicKey: string, privateKey: string }} PEM-encoded key strings
 */
export function generateKeypair() {
  return generateKeyPairSync('ed25519', {
    publicKeyEncoding:  { type: 'spki',  format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

// ---------------------------------------------------------------------------
// Signing
// ---------------------------------------------------------------------------

/**
 * Sign skill content with Ed25519.
 * @param {string} content     - Raw skill file content
 * @param {string} privateKey  - PKCS8 PEM private key
 * @returns {Promise<{ hash: string, signature: string, signedAt: string }>}
 */
export async function signSkill(content, privateKey) {
  const hash      = createHash('sha256').update(content).digest('hex');
  const signedAt  = new Date().toISOString();
  const payload   = `${hash}|${signedAt}`;

  const sigBuffer = sign(null, Buffer.from(payload), privateKey);
  const signature = sigBuffer.toString('base64');

  return { hash, signature, signedAt };
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

/**
 * Verify a signed skill entry.
 * @param {string}      content    - Raw skill file content
 * @param {object|null} entry      - Manifest entry { hash, signature, signedAt }
 * @param {string}      publicKey  - SPKI PEM public key
 * @returns {Promise<'VERIFIED'|'TAMPERED'|'UNSIGNED'>}
 */
export async function verifySkill(content, entry, publicKey) {
  if (entry == null) return 'UNSIGNED';

  const actualHash = createHash('sha256').update(content).digest('hex');
  if (actualHash !== entry.hash) return 'TAMPERED';

  const payload = `${entry.hash}|${entry.signedAt}`;
  const sigBuffer = Buffer.from(entry.signature, 'base64');

  let valid = false;
  try {
    valid = verify(null, Buffer.from(payload), publicKey, sigBuffer);
  } catch {
    return 'TAMPERED';
  }

  return valid ? 'VERIFIED' : 'TAMPERED';
}

// ---------------------------------------------------------------------------
// Manifest I/O
// ---------------------------------------------------------------------------

const SKELETON_MANIFEST = () => ({ version: 1, signedAt: null, skills: {} });

/**
 * Load manifest.json from disk.
 * Returns skeleton if file does not exist.
 * @param {string} manifestPath
 * @returns {Promise<object>}
 */
export async function loadManifest(manifestPath) {
  try {
    const raw = await readFile(manifestPath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return SKELETON_MANIFEST();
    throw err;
  }
}

/**
 * Write manifest atomically: write to <path>.tmp then rename.
 * @param {string} manifestPath
 * @param {object} manifest
 */
export async function saveManifest(manifestPath, manifest) {
  const tmp = manifestPath + '.tmp';
  await writeFile(tmp, JSON.stringify(manifest, null, 2), 'utf8');
  await rename(tmp, manifestPath);
}

// ---------------------------------------------------------------------------
// Sign all skills
// ---------------------------------------------------------------------------

/**
 * Extract the `name` field from YAML frontmatter.
 * Returns null if no frontmatter or no name field found.
 * @param {string} content
 * @returns {string|null}
 */
function extractName(content) {
  const parts = content.split('---');
  // parts[0] is before the opening ---, parts[1] is the frontmatter block
  if (parts.length < 3) return null;
  const frontmatter = parts[1];
  for (const line of frontmatter.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('name:')) {
      return trimmed.slice('name:'.length).trim();
    }
  }
  return null;
}

/**
 * Read all .md files from {config.home}/skills/, sign each, and write
 * {config.home}/manifest.json.
 *
 * @param {{ home: string, privateKey: string }} config
 */
export async function signAllSkills(config) {
  const { home, privateKey } = config;
  const skillsDir    = join(home, 'skills');
  const manifestPath = join(home, 'manifest.json');

  const entries = await readdir(skillsDir);
  const mdFiles = entries.filter(f => f.endsWith('.md'));

  const skills = {};

  for (const filename of mdFiles) {
    const filePath = join(skillsDir, filename);
    const content  = await readFile(filePath, 'utf8');
    const name     = extractName(content) ?? filename.replace(/\.md$/, '');
    const entry    = await signSkill(content, privateKey);
    skills[name]   = entry;
  }

  const manifest = {
    version:  1,
    signedAt: new Date().toISOString(),
    skills,
  };

  await saveManifest(manifestPath, manifest);
}
