/**
 * mcp-librarian setup — generates keys, copies skills, signs manifest,
 * configures MCP clients, installs platform service.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { getLibDir, getSkillsDir, getPacksDir, getStagingDir, getBundledSkillsDir } from './paths.js';
import { IntegrityEngine } from '../librarian/integrity.js';
import { ensureDir } from '../security/permissions.js';

export async function generateKeys(libDir, flags) {
  const pubPath = join(libDir, 'ed25519.pub');
  const privPath = join(libDir, 'ed25519.priv');

  if (existsSync(pubPath) && existsSync(privPath) && !flags['force-keygen']) {
    console.log('  Keys already exist, skipping (use --force-keygen to regenerate)');
    return;
  }

  const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  writeFileSync(pubPath, publicKey, { mode: 0o600 });
  writeFileSync(privPath, privateKey, { mode: 0o600 });
  console.log('  Ed25519 keypair generated');
}

export async function generateSecrets(libDir, flags) {
  const secrets = ['client.secret', 'librarian.secret', 'audit.secret'];

  for (const name of secrets) {
    const path = join(libDir, name);
    if (existsSync(path) && !flags['force-keygen']) continue;
    writeFileSync(path, randomBytes(32).toString('hex'), { mode: 0o600 });
  }

  console.log('  HMAC secrets ready');
}

export async function copyBundledSkills(bundledDir, targetDir) {
  if (!existsSync(bundledDir)) return;
  mkdirSync(targetDir, { recursive: true });

  const entries = readdirSync(bundledDir, { withFileTypes: true });
  let copied = 0;
  let skipped = 0;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const srcSkill = join(bundledDir, entry.name, 'SKILL.md');
    if (!existsSync(srcSkill)) continue;

    const destDir = join(targetDir, entry.name);
    const destSkill = join(destDir, 'SKILL.md');

    if (existsSync(destSkill)) {
      skipped++;
      continue;
    }

    mkdirSync(destDir, { recursive: true });
    cpSync(srcSkill, destSkill);
    copied++;
  }

  console.log(`  Skills: ${copied} copied, ${skipped} already exist`);
}

export async function signAllSkills(libDir, skillsDir, packsDir) {
  const pubKey = readFileSync(join(libDir, 'ed25519.pub'), 'utf8');
  const privKey = readFileSync(join(libDir, 'ed25519.priv'), 'utf8');

  const engine = new IntegrityEngine(libDir, pubKey, privKey);
  engine.manifestPath = join(libDir, 'manifest.json');

  const contents = {};

  if (existsSync(skillsDir)) {
    for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const p = join(skillsDir, entry.name, 'SKILL.md');
      if (existsSync(p)) contents[entry.name] = readFileSync(p, 'utf8');
    }
  }

  if (existsSync(packsDir)) {
    for (const pack of readdirSync(packsDir, { withFileTypes: true })) {
      if (!pack.isDirectory()) continue;
      const packSkills = join(packsDir, pack.name, 'skills');
      if (!existsSync(packSkills)) continue;
      for (const entry of readdirSync(packSkills, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const p = join(packSkills, entry.name, 'SKILL.md');
        if (existsSync(p) && !contents[entry.name]) {
          contents[entry.name] = readFileSync(p, 'utf8');
        }
      }
    }
  }

  const manifest = engine.signAll(contents);
  console.log(`  Signed ${Object.keys(manifest.skills).length} skills`);
}

export async function runSetup(flags) {
  if (flags['dry-run']) {
    console.log('[mcp-librarian] Dry run — showing what would happen:\n');
  }

  const libDir = getLibDir();
  const skillsDir = getSkillsDir();
  const packsDir = getPacksDir();
  const stagingDir = getStagingDir();
  const bundledDir = getBundledSkillsDir();

  console.log('');
  console.log('  \x1b[1mmcp-librarian setup\x1b[0m');
  console.log(`  Runtime:  ${libDir}`);
  console.log(`  Bundled:  ${bundledDir}`);
  console.log('');

  console.log('[1/6] Creating runtime directories...');
  if (!flags['dry-run']) {
    ensureDir(libDir, 0o700);
    mkdirSync(skillsDir, { recursive: true });
    mkdirSync(packsDir, { recursive: true });
    mkdirSync(stagingDir, { recursive: true });
  }

  console.log('[2/6] Generating cryptographic material...');
  if (!flags['dry-run']) {
    await generateKeys(libDir, flags);
    await generateSecrets(libDir, flags);
  }

  console.log('[3/6] Installing bundled skills...');
  if (!flags['dry-run']) {
    await copyBundledSkills(bundledDir, skillsDir);
  }

  console.log('[4/6] Signing skill manifest...');
  if (!flags['dry-run']) {
    await signAllSkills(libDir, skillsDir, packsDir);
  }

  if (!flags['skip-service']) {
    console.log('[5/6] Installing service...');
    if (!flags['dry-run']) {
      const { installService } = await import('./service.js');
      await installService();
    }
  } else {
    console.log('[5/6] Skipping service install (--skip-service)');
  }

  if (!flags['skip-clients']) {
    console.log('[6/6] Configuring MCP clients...');
    if (!flags['dry-run']) {
      const { configureClients } = await import('./setup-clients.js');
      await configureClients(flags);
    }
  } else {
    console.log('[6/6] Skipping client config (--skip-clients)');
  }

  console.log('');
  console.log('\x1b[32m  Setup complete.\x1b[0m');
  console.log(`  Start: mcp-librarian start`);
  console.log(`  Status: mcp-librarian status`);
  console.log('');
}
