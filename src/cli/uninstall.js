/**
 * Clean removal of mcp-librarian runtime state, services, and client configs.
 */

import { existsSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { getLibDir } from './paths.js';
import { stopService, detectPlatform, getPlistPath } from './service.js';

export async function runUninstall(flags) {
  const libDir = getLibDir();

  if (!flags.yes) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise(resolve => {
      rl.question(`\nThis will remove ${libDir} and all services. Continue? [y/N] `, resolve);
    });
    rl.close();
    if (answer.toLowerCase() !== 'y') {
      console.log('Cancelled.');
      return;
    }
  }

  // Stop service
  console.log('Stopping service...');
  await stopService();

  // Remove service files
  const plistPath = getPlistPath();
  if (existsSync(plistPath)) {
    rmSync(plistPath, { force: true });
    console.log(`  Removed: ${plistPath}`);
  }

  // Remove MCP client configs
  console.log('Removing MCP client configurations...');
  removeClientConfigs();

  // Remove runtime dir
  if (existsSync(libDir)) {
    rmSync(libDir, { recursive: true, force: true });
    console.log(`  Removed: ${libDir}`);
  }

  console.log('\nUninstall complete. Run `npm uninstall -g mcp-librarian` to remove the package.');
}

function removeClientConfigs() {
  // Claude Code
  try {
    const env = { ...process.env };
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;
    execSync('claude mcp remove --scope user librarian', { env, stdio: 'pipe' });
    console.log('  Claude Code: removed');
  } catch {
    console.log('  Claude Code: not configured or claude CLI not found');
  }

  // cclocal
  const ccPath = join(homedir(), '.claude-local', 'claude.json');
  if (existsSync(ccPath)) {
    try {
      const config = JSON.parse(readFileSync(ccPath, 'utf8'));
      for (const proj of Object.values(config.projects || {})) {
        if (proj.mcpServers?.librarian) delete proj.mcpServers.librarian;
      }
      writeFileSync(ccPath, JSON.stringify(config, null, 2) + '\n');
      console.log('  cclocal: removed');
    } catch {}
  }

  // Crush
  const crushPath = join(homedir(), '.config', 'crush', 'config.json');
  if (existsSync(crushPath)) {
    try {
      const config = JSON.parse(readFileSync(crushPath, 'utf8'));
      if (config.mcpServers?.librarian) delete config.mcpServers.librarian;
      writeFileSync(crushPath, JSON.stringify(config, null, 2) + '\n');
      console.log('  Crush: removed');
    } catch {}
  }
}
