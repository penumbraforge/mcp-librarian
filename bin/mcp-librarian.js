#!/usr/bin/env node

/**
 * mcp-librarian — Main server process.
 * Loads skills, builds BM25 index, starts UDS server, runs librarian.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import { SocketServer } from '../src/server/socket-server.js';
import { Authenticator } from '../src/server/auth.js';
import { Protocol } from '../src/server/protocol.js';
import { SkillStore } from '../src/store/skill-store.js';
import { AuditLog } from '../src/security/audit-log.js';
import { loadPublicKey, loadPrivateKey } from '../src/security/ed25519.js';
import { ensureDir } from '../src/security/permissions.js';
import { Librarian } from '../src/librarian/index.js';

// Tool definitions + handlers
import * as findSkill from '../src/tools/find-skill.js';
import * as loadSection from '../src/tools/load-section.js';
import * as listSkills from '../src/tools/list-skills.js';
import * as loadSkill from '../src/tools/load-skill.js';
import * as skillStatus from '../src/tools/skill-status.js';
import * as librarianCurate from '../src/tools/librarian-curate.js';
import * as librarianPromote from '../src/tools/librarian-promote.js';
import * as librarianStatusTool from '../src/tools/librarian-status.js';
import * as addSkill from '../src/tools/add-skill.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');

// Paths
const LIB_DIR = join(homedir(), '.mcp-librarian');
const SOCKET_PATH = join(LIB_DIR, 'librarian.sock');
const SKILLS_DIR = join(PROJECT_ROOT, 'skills');
const STAGING_DIR = join(PROJECT_ROOT, 'staging');

// Config
let config = {};
const configPath = join(PROJECT_ROOT, 'config', 'default.json');
if (existsSync(configPath)) {
  config = JSON.parse(readFileSync(configPath, 'utf8'));
}

// Load secrets
function loadSecret(name) {
  const path = join(LIB_DIR, name);
  if (!existsSync(path)) {
    console.error(`[mcp-librarian] Missing ${path} — run bin/install.sh first`);
    process.exit(1);
  }
  return readFileSync(path, 'utf8').trim();
}

async function main() {
  console.log('[mcp-librarian] Starting...');

  ensureDir(LIB_DIR, 0o700);

  const clientSecret = loadSecret('client.secret');
  const librarianSecret = loadSecret('librarian.secret');

  // Load Ed25519 keys
  let publicKey = null;
  let privateKey = null;
  const pubPath = join(LIB_DIR, 'ed25519.pub');
  const privPath = join(LIB_DIR, 'ed25519.priv');
  if (existsSync(pubPath)) publicKey = loadPublicKey(pubPath);
  if (existsSync(privPath)) privateKey = loadPrivateKey(privPath);

  // Audit log
  const auditLog = new AuditLog(
    join(LIB_DIR, 'audit.jsonl'),
    clientSecret // Use client secret as HMAC key for audit chain
  );

  // Skill store
  const store = new SkillStore(SKILLS_DIR, { publicKey });
  const loaded = store.loadAll();
  console.log(`[mcp-librarian] Loaded ${loaded} skills, ${store.bm25.documentCount} indexed chunks`);

  // Librarian
  const librarian = new Librarian({
    skillsDir: SKILLS_DIR,
    stagingDir: STAGING_DIR,
    store,
    auditLog,
    publicKey,
    privateKey,
  });

  // Protocol + tools
  const protocol = new Protocol(store, auditLog);

  protocol.registerTool(findSkill.definition.name, findSkill.handler(store), {
    description: findSkill.definition.description,
    inputSchema: findSkill.definition.inputSchema,
  });

  protocol.registerTool(loadSection.definition.name, loadSection.handler(store), {
    description: loadSection.definition.description,
    inputSchema: loadSection.definition.inputSchema,
  });

  protocol.registerTool(listSkills.definition.name, listSkills.handler(store), {
    description: listSkills.definition.description,
    inputSchema: listSkills.definition.inputSchema,
  });

  protocol.registerTool(loadSkill.definition.name, loadSkill.handler(store), {
    description: loadSkill.definition.description,
    inputSchema: loadSkill.definition.inputSchema,
  });

  protocol.registerTool(skillStatus.definition.name, skillStatus.handler(store), {
    description: skillStatus.definition.description,
    inputSchema: skillStatus.definition.inputSchema,
  });

  protocol.registerTool(librarianCurate.definition.name, librarianCurate.handler(librarian), {
    description: librarianCurate.definition.description,
    inputSchema: librarianCurate.definition.inputSchema,
    role: 'librarian',
  });

  protocol.registerTool(librarianPromote.definition.name, librarianPromote.handler(librarian), {
    description: librarianPromote.definition.description,
    inputSchema: librarianPromote.definition.inputSchema,
    role: 'librarian',
  });

  protocol.registerTool(librarianStatusTool.definition.name, librarianStatusTool.handler(librarian), {
    description: librarianStatusTool.definition.description,
    inputSchema: librarianStatusTool.definition.inputSchema,
  });

  protocol.registerTool(addSkill.definition.name, addSkill.handler(librarian.staging), {
    description: addSkill.definition.description,
    inputSchema: addSkill.definition.inputSchema,
    role: 'librarian',
  });

  // Auth
  const authenticator = new Authenticator(clientSecret, librarianSecret);

  // Socket server
  const server = new SocketServer(SOCKET_PATH, authenticator, protocol, auditLog, {
    rateLimit: config.rateLimit,
  });

  await server.start();
  console.log(`[mcp-librarian] Listening on ${SOCKET_PATH}`);

  // Start librarian
  librarian.start();
  console.log('[mcp-librarian] Librarian worker started (5 min cycle)');

  // Graceful shutdown
  const shutdown = async (signal) => {
    console.log(`\n[mcp-librarian] ${signal} received, shutting down...`);
    librarian.stop();
    await server.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch(e => {
  console.error(`[mcp-librarian] Fatal: ${e.message}`);
  process.exit(1);
});
