#!/usr/bin/env node
import { loadConfig } from '../src/config/config.js';
import { signAllSkills } from '../src/security/ed25519.js';
import { SkillStore } from '../src/store/skill-store.js';
import { StdioTransport } from '../src/transport/stdio.js';
import { Dispatcher } from '../src/protocol/dispatcher.js';
import { McpLogger } from '../src/protocol/logging.js';
import { getToolDefinitions, handleToolCall } from '../src/protocol/tools.js';
import { listResources, readResource } from '../src/protocol/resources.js';
import { listPrompts, getPrompt } from '../src/protocol/prompts.js';
import { checkContent } from '../src/security/content-guard.js';
import * as ed25519 from '../src/security/ed25519.js';
import { homedir } from 'node:os';
import { join } from 'node:path';

const home = process.env.MCP_LIBRARIAN_HOME || join(homedir(), '.mcp-librarian');
const config = await loadConfig(home);
const args = process.argv.slice(2);

// Sign subcommand
if (args[0] === 'sign') {
  await signAllSkills(config);
  process.stderr.write('Skills signed successfully.\n');
  process.exit(0);
}

// Default: start stdio server
const store = new SkillStore(config);
await store.load();

const transport = new StdioTransport(process.stdin, process.stdout);
const logger = new McpLogger(transport, config.logLevel);
const dispatcher = new Dispatcher(store, config, transport);

// Wire tool handlers
dispatcher.setToolHandlers(
  getToolDefinitions(),
  (name, toolArgs) => handleToolCall(name, toolArgs, { store, config, logger, contentGuard: { checkContent }, ed25519 })
);

// Wire resource handlers
dispatcher.setResourceHandlers(
  () => listResources(store),
  (uri) => readResource(uri, store)
);

// Wire prompt handlers
dispatcher.setPromptHandlers(
  () => listPrompts(),
  (name, promptArgs) => getPrompt(name, promptArgs)
);

// Route messages
transport.onMessage((msg) => dispatcher.handleMessage(msg));

// Graceful shutdown
process.on('SIGTERM', () => process.exit(0));
process.stdin.on('end', () => process.exit(0));

logger.info('mcp-librarian started', { skillCount: store.stats().skillCount });
