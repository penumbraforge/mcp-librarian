#!/usr/bin/env node
/**
 * mcp-librarian install script.
 *
 * Uses ONLY node: built-ins. No external dependencies.
 *
 * What it does:
 *  1. Determines the home directory (~/.mcp-librarian or $MCP_LIBRARIAN_HOME)
 *  2. Creates the directory structure (skills/, keys/)
 *  3. Generates an Ed25519 keypair and writes keys with mode 0o600
 *  4. Writes a skeleton manifest.json
 *  5. Auto-detects known MCP clients and offers to configure each
 *  6. Prints manual instructions for un-detected clients
 *  7. Prints next-steps success message
 */

import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { generateKeypair } from '../src/security/ed25519.js';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

// Absolute path to bin/mcp-librarian.js — used in client configs
const entryPoint = resolve(__dirname, 'mcp-librarian.js');

const home = process.env.MCP_LIBRARIAN_HOME || join(homedir(), '.mcp-librarian');
const keysDir      = join(home, 'keys');
const skillsDir    = join(home, 'skills');
const publicKeyPath  = join(keysDir, 'public.pem');
const privateKeyPath = join(keysDir, 'private.pem');
const manifestPath   = join(home, 'manifest.json');

// ---------------------------------------------------------------------------
// Readline helper
// ---------------------------------------------------------------------------

/**
 * Ask a yes/no question on stdin/stdout.
 * Defaults to false (no) if stdin is already closed or closes mid-question.
 * @param {{ rl: readline.Interface, closed: boolean }} ctx
 * @param {string} question
 * @returns {Promise<boolean>}
 */
function ask(ctx, question) {
  // If stdin already closed, default to "no" immediately
  if (ctx.closed) {
    process.stdout.write(`${question} (y/n) n\n`);
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    let settled = false;

    const settle = (value) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };

    // If readline closes before we get an answer, default to false
    ctx.rl.once('close', () => settle(false));

    ctx.rl.question(`${question} (y/n) `, (answer) => {
      settle(answer.trim().toLowerCase() === 'y');
    });
  });
}

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

async function fileExists(path) {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Client detection helpers
// ---------------------------------------------------------------------------

/**
 * Try to detect Claude Code CLI.
 * Returns true if `claude --version` succeeds.
 */
function detectClaudeCode() {
  try {
    execSync('claude --version', { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Configure Claude Code via `claude mcp add`.
 */
function configureClaudeCode() {
  execSync(
    `claude mcp add mcp-librarian node -- "${entryPoint}"`,
    { stdio: 'inherit', timeout: 10000 }
  );
}

/**
 * Try to add mcp-librarian to a JSON-based MCP config file (Cursor / Windsurf).
 * Creates the file if it does not exist.
 * @param {string} configPath
 */
async function configureJsonClient(configPath) {
  let config = {};

  if (await fileExists(configPath)) {
    try {
      const raw = await readFile(configPath, 'utf8');
      config = JSON.parse(raw);
    } catch {
      // Corrupted config — start fresh
      config = {};
    }
  }

  // Ensure mcpServers key exists
  if (typeof config.mcpServers !== 'object' || config.mcpServers === null) {
    config.mcpServers = {};
  }

  config.mcpServers['mcp-librarian'] = {
    command: 'node',
    args: [entryPoint],
  };

  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  // Shared context so ask() can detect if readline is already closed
  const ctx = { rl, closed: false };
  rl.on('close', () => { ctx.closed = true; });

  try {
    process.stdout.write(`\nmcp-librarian installer\n`);
    process.stdout.write(`Home: ${home}\n\n`);

    // -----------------------------------------------------------------------
    // Step 1: Check if home already exists and has keys
    // -----------------------------------------------------------------------
    const keysExist = (await fileExists(publicKeyPath)) && (await fileExists(privateKeyPath));

    if (keysExist) {
      const overwrite = await ask(ctx, `Keys already exist at ${keysDir}. Regenerate keypair?`);
      if (!overwrite) {
        process.stdout.write('Keeping existing keys.\n');
      } else {
        process.stdout.write('Regenerating keypair...\n');
        await generateAndWriteKeys();
      }
    } else {
      // -----------------------------------------------------------------------
      // Step 2: Create directory structure
      // -----------------------------------------------------------------------
      await mkdir(skillsDir, { recursive: true });
      await mkdir(keysDir,   { recursive: true });

      // -----------------------------------------------------------------------
      // Step 3: Generate Ed25519 keypair
      // -----------------------------------------------------------------------
      process.stdout.write('Generating Ed25519 keypair...\n');
      await generateAndWriteKeys();
    }

    // -----------------------------------------------------------------------
    // Step 4: Write skeleton manifest (only if it does not exist)
    // -----------------------------------------------------------------------
    if (!(await fileExists(manifestPath))) {
      const skeleton = { version: 1, signedAt: null, skills: {} };
      await writeFile(manifestPath, JSON.stringify(skeleton, null, 2) + '\n', 'utf8');
      process.stdout.write('Wrote skeleton manifest.json.\n');
    }

    // -----------------------------------------------------------------------
    // Step 5: Auto-detect MCP clients
    // -----------------------------------------------------------------------
    process.stdout.write('\nDetecting MCP clients...\n');

    const configuredClients = [];

    // --- Claude Code ---
    try {
      if (detectClaudeCode()) {
        process.stdout.write('Found Claude Code.\n');
        const yes = await ask(ctx, 'Configure mcp-librarian for Claude Code?');
        if (yes) {
          try {
            configureClaudeCode();
            configuredClients.push('Claude Code');
            process.stdout.write('  Claude Code configured.\n');
          } catch (err) {
            process.stderr.write(`  Warning: failed to configure Claude Code: ${err.message}\n`);
          }
        }
      }
    } catch {
      // Detection itself failed — skip
    }

    // --- Cursor ---
    const cursorConfig = join(homedir(), '.cursor', 'mcp.json');
    try {
      const cursorExists = await fileExists(join(homedir(), '.cursor'));
      if (cursorExists) {
        process.stdout.write('Found Cursor config directory.\n');
        const yes = await ask(ctx, 'Configure mcp-librarian for Cursor?');
        if (yes) {
          try {
            await configureJsonClient(cursorConfig);
            configuredClients.push('Cursor');
            process.stdout.write('  Cursor configured.\n');
          } catch (err) {
            process.stderr.write(`  Warning: failed to configure Cursor: ${err.message}\n`);
          }
        }
      }
    } catch {
      // Skip on any error
    }

    // --- Windsurf ---
    const windsurfConfig = join(homedir(), '.windsurf', 'mcp.json');
    try {
      const windsurfExists = await fileExists(join(homedir(), '.windsurf'));
      if (windsurfExists) {
        process.stdout.write('Found Windsurf config directory.\n');
        const yes = await ask(ctx, 'Configure mcp-librarian for Windsurf?');
        if (yes) {
          try {
            await configureJsonClient(windsurfConfig);
            configuredClients.push('Windsurf');
            process.stdout.write('  Windsurf configured.\n');
          } catch (err) {
            process.stderr.write(`  Warning: failed to configure Windsurf: ${err.message}\n`);
          }
        }
      }
    } catch {
      // Skip on any error
    }

    // -----------------------------------------------------------------------
    // Step 6: Print manual instructions if no clients were auto-configured
    // -----------------------------------------------------------------------
    if (configuredClients.length === 0) {
      process.stdout.write(`
To configure manually, add this to your MCP client config:
{
  "mcp-librarian": {
    "command": "node",
    "args": ["${entryPoint}"]
  }
}
`);
    }

    // -----------------------------------------------------------------------
    // Step 7: Success message
    // -----------------------------------------------------------------------
    const displayHome = home.startsWith(homedir())
      ? home.replace(homedir(), '~')
      : home;

    process.stdout.write(`
\u2713 mcp-librarian installed at ${displayHome}

Next steps:
1. Install a skill pack:  Ask your AI: "Use install_pack to install the security pack"
2. Create your own skill: Ask your AI: "Create a skill about [your topic]"
3. Search your skills:    Ask your AI: "Find skills about [query]"
`);

  } finally {
    rl.close();
  }
}

// ---------------------------------------------------------------------------
// Key generation helper (shared by initial install and overwrite path)
// ---------------------------------------------------------------------------

async function generateAndWriteKeys() {
  // Ensure directories exist even on the overwrite path
  await mkdir(keysDir,   { recursive: true });
  await mkdir(skillsDir, { recursive: true });

  const { publicKey, privateKey } = generateKeypair();
  await writeFile(publicKeyPath,  publicKey,  { mode: 0o600 });
  await writeFile(privateKeyPath, privateKey, { mode: 0o600 });
  process.stdout.write(`  Public key:  ${publicKeyPath}\n`);
  process.stdout.write(`  Private key: ${privateKeyPath}\n`);
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

main().catch((err) => {
  process.stderr.write(`Install failed: ${err.message}\n`);
  process.exit(1);
});
