#!/usr/bin/env node

/**
 * mcp-librarian CLI — Unified entry point.
 * Routes subcommands to handler modules.
 *
 * Penumbra Forge | MIT License
 */

import { parseArgs } from '../src/cli/parse-args.js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));

const argv = process.argv.slice(2);
const { command, flags, args } = parseArgs(argv);

async function run() {
  switch (command) {
    case 'setup': {
      const { runSetup } = await import('../src/cli/setup.js');
      await runSetup(flags);
      break;
    }
    case 'start': {
      await import('./mcp-librarian.js');
      break;
    }
    case 'stop': {
      const { stopService } = await import('../src/cli/service.js');
      await stopService();
      break;
    }
    case 'restart': {
      const { restartService } = await import('../src/cli/service.js');
      await restartService();
      break;
    }
    case 'status': {
      const { showStatus } = await import('../src/cli/service.js');
      await showStatus();
      break;
    }
    case 'uninstall': {
      const { runUninstall } = await import('../src/cli/uninstall.js');
      await runUninstall(flags);
      break;
    }
    case 'install-pack': {
      const { installPack } = await import('../src/cli/packs.js');
      if (!args[0]) { console.error('Usage: mcp-librarian install-pack <github-user/repo>'); process.exit(1); }
      await installPack(args[0]);
      break;
    }
    case 'update-pack': {
      const { updatePack } = await import('../src/cli/packs.js');
      if (!args[0]) { console.error('Usage: mcp-librarian update-pack <pack-name>'); process.exit(1); }
      await updatePack(args[0]);
      break;
    }
    case 'list-packs': {
      const { listPacks } = await import('../src/cli/packs.js');
      await listPacks();
      break;
    }
    case 'remove-pack': {
      const { removePack } = await import('../src/cli/packs.js');
      if (!args[0]) { console.error('Usage: mcp-librarian remove-pack <pack-name>'); process.exit(1); }
      await removePack(args[0]);
      break;
    }
    case 'create-skill': {
      const { createSkill } = await import('../src/cli/skills.js');
      if (!args[0]) { console.error('Usage: mcp-librarian create-skill <name>'); process.exit(1); }
      await createSkill(args[0]);
      break;
    }
    case 'export-pack': {
      const { exportPack } = await import('../src/cli/packs.js');
      if (!args[0]) { console.error('Usage: mcp-librarian export-pack <output-dir>'); process.exit(1); }
      await exportPack(args[0]);
      break;
    }
    case 'version':
      console.log(`mcp-librarian v${pkg.version}`);
      break;
    case 'help':
    default:
      console.log(`
  mcp-librarian v${pkg.version} — Penumbra Forge

  Usage: mcp-librarian <command> [options]

  Commands:
    setup              Generate keys, sign skills, configure MCP clients & service
    start              Start the server (foreground)
    stop               Stop the running service
    restart            Restart the service
    status             Show server and service status
    uninstall          Remove runtime files, services, and client configs

    install-pack <user/repo>   Install a skill pack from GitHub
    update-pack <name>         Update an installed pack
    list-packs                 List installed packs
    remove-pack <name>         Remove an installed pack
    create-skill <name>        Scaffold a new skill
    export-pack <dir>          Bundle skills for sharing

  Setup flags:
    --dry-run          Preview changes without applying
    --skip-clients     Skip MCP client auto-configuration
    --skip-service     Skip service installation
    --only <client>    Configure only one client (claude-code, cclocal, crush)
    --force-keygen     Regenerate keys even if they exist

  Examples:
    npm install -g mcp-librarian
    mcp-librarian setup
    mcp-librarian install-pack penumbraforge/devops-pack
`);
      break;
  }
}

run().catch(e => {
  console.error(`[mcp-librarian] ${e.message}`);
  process.exit(1);
});
