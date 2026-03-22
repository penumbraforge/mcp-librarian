/**
 * Auto-detect and configure MCP clients.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(__dirname, '..', '..');
const STDIO_PATH = join(PACKAGE_ROOT, 'bin', 'mcp-librarian-stdio.js');
const NODE_PATH = process.execPath;

export async function configureClients(flags) {
  const onlyClient = flags.only;

  if (!onlyClient || onlyClient === 'claude-code') {
    configureClaudeCode();
  }
  if (!onlyClient || onlyClient === 'cclocal') {
    configureCclocal();
  }
  if (!onlyClient || onlyClient === 'crush') {
    configureCrush();
  }
}

function configureClaudeCode() {
  try {
    execSync('which claude', { encoding: 'utf8', stdio: 'pipe' });
    const env = { ...process.env };
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;
    try { execSync(`claude mcp remove --scope user librarian`, { env, stdio: 'pipe' }); } catch {}
    execSync(`claude mcp add --scope user librarian -- "${NODE_PATH}" "${STDIO_PATH}"`, { env, stdio: 'pipe' });
    console.log('  Claude Code: configured');
  } catch {
    console.log(`  Claude Code: 'claude' CLI not found, configure manually:`);
    console.log(`    claude mcp add --scope user librarian -- ${NODE_PATH} ${STDIO_PATH}`);
  }
}

function configureCclocal() {
  const ccDir = join(homedir(), '.claude-local');
  if (!existsSync(ccDir)) { console.log('  cclocal: not found, skipping'); return; }

  const configPath = join(ccDir, 'claude.json');
  let config = {};
  if (existsSync(configPath)) {
    try { config = JSON.parse(readFileSync(configPath, 'utf8')); } catch {}
  }

  if (!config.projects) config.projects = {};
  const homeKey = homedir();
  if (!config.projects[homeKey]) config.projects[homeKey] = {};
  if (!config.projects[homeKey].mcpServers) config.projects[homeKey].mcpServers = {};

  config.projects[homeKey].mcpServers.librarian = {
    type: 'stdio',
    command: NODE_PATH,
    args: [STDIO_PATH],
  };

  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  console.log('  cclocal: configured');
}

function configureCrush() {
  const crushConfig = join(homedir(), '.config', 'crush', 'config.json');
  if (!existsSync(crushConfig)) { console.log('  Crush: not found, skipping'); return; }

  let config;
  try { config = JSON.parse(readFileSync(crushConfig, 'utf8')); } catch { return; }
  if (!config.mcpServers) config.mcpServers = {};

  config.mcpServers.librarian = {
    command: NODE_PATH,
    args: [STDIO_PATH],
  };

  writeFileSync(crushConfig, JSON.stringify(config, null, 2) + '\n');
  console.log('  Crush: configured');
}
