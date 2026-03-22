/**
 * Shared path resolution for CLI and server.
 * All writable state lives under LIB_DIR (~/.mcp-librarian).
 * On Linux, respects $XDG_DATA_HOME if set.
 */

import { homedir, platform } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(__dirname, '..', '..');

export function getLibDir() {
  if (platform() === 'linux' && process.env.XDG_DATA_HOME) {
    return join(process.env.XDG_DATA_HOME, 'mcp-librarian');
  }
  return join(homedir(), '.mcp-librarian');
}

export function getSkillsDir() {
  return join(getLibDir(), 'skills');
}

export function getPacksDir() {
  return join(getLibDir(), 'packs');
}

export function getStagingDir() {
  return join(getLibDir(), 'staging');
}

export function getManifestPath() {
  return join(getLibDir(), 'manifest.json');
}

export function getSocketPath() {
  return join(getLibDir(), 'librarian.sock');
}

export function getPidPath() {
  return join(getLibDir(), 'librarian.pid');
}

export function getBundledSkillsDir() {
  return join(PACKAGE_ROOT, 'skills');
}

export function getConfigPath() {
  return join(PACKAGE_ROOT, 'config', 'default.json');
}
