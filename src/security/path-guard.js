/**
 * Path Guard — validates file paths are within an allowed directory.
 *
 * Resolves symlinks via fs/promises realpath and enforces containment.
 * This module is the single source of truth for path containment — do not
 * hand-roll traversal checks at call sites.
 *
 * @module path-guard
 */

import { realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

import { McpError, ERROR_CODES } from '../errors.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate that `filePath` is within `allowedDir`.
 *
 * Checks performed (in order):
 *   1. Reject null bytes in path
 *   2. Reject `../` traversal sequences in the raw path
 *   3. Resolve the real path (follows symlinks) via fs realpath
 *   4. Verify the resolved path starts with the resolved allowedDir
 *
 * @param {string} filePath    - The path to validate
 * @param {string} allowedDir  - The directory that must contain the path
 * @returns {Promise<string>}  - Resolved real path if valid
 * @throws {McpError}          - PATH_VIOLATION if any check fails
 */
export async function validatePath(filePath, allowedDir) {
  // 1. Reject null bytes
  if (filePath.includes('\x00')) {
    throw new McpError(
      ERROR_CODES.PATH_VIOLATION,
      'Path contains null byte',
      { filePath }
    );
  }

  // 2. Reject explicit traversal sequences
  if (filePath.includes('../') || filePath.includes('..\\')) {
    throw new McpError(
      ERROR_CODES.PATH_VIOLATION,
      'Path contains traversal sequence',
      { filePath }
    );
  }

  // 3 & 4. Resolve real paths (follows symlinks) and compare
  let resolvedAllowed;
  try {
    resolvedAllowed = await realpath(allowedDir);
  } catch (err) {
    throw new McpError(
      ERROR_CODES.PATH_VIOLATION,
      `Cannot resolve allowed directory: ${err.message}`,
      { allowedDir }
    );
  }

  let resolvedFile;
  try {
    resolvedFile = await realpath(filePath);
  } catch (err) {
    throw new McpError(
      ERROR_CODES.PATH_VIOLATION,
      `Cannot resolve file path: ${err.message}`,
      { filePath }
    );
  }

  // Ensure resolvedAllowed ends with a separator so that prefix matching
  // doesn't falsely accept /allowed-dir-extra/file when allowed is /allowed-dir
  const normalizedAllowed = resolvedAllowed.endsWith('/')
    ? resolvedAllowed
    : resolvedAllowed + '/';

  // The file is allowed if it IS the allowed dir or is inside it
  const isContained =
    resolvedFile === resolvedAllowed ||
    resolvedFile.startsWith(normalizedAllowed);

  if (!isContained) {
    throw new McpError(
      ERROR_CODES.PATH_VIOLATION,
      'Path resolves outside allowed directory',
      { filePath, resolvedFile, allowedDir: resolvedAllowed }
    );
  }

  return resolvedFile;
}

/**
 * Validate a path that does not exist yet (a file or directory about to be
 * created) stays within `allowedDir`.
 *
 * realpath() can't be used on the target (it doesn't exist), so this:
 *   1. rejects null bytes and explicit traversal sequences
 *   2. realpaths allowedDir (must exist — symlinked homes are common)
 *   3. lexically resolves the target against it and enforces containment
 *
 * @param {string} candidate   - Relative path (or bare name) to be created
 * @param {string} allowedDir  - Existing directory that must contain it
 * @returns {Promise<string>}  - Absolute path to create, inside allowedDir
 * @throws {McpError}          - PATH_VIOLATION if any check fails
 */
export async function validateNewPath(candidate, allowedDir) {
  if (typeof candidate !== 'string' || candidate.length === 0) {
    throw new McpError(ERROR_CODES.PATH_VIOLATION, 'Path must be a non-empty string', { candidate });
  }
  if (candidate.includes('\x00')) {
    throw new McpError(ERROR_CODES.PATH_VIOLATION, 'Path contains null byte', { candidate });
  }
  if (candidate.includes('../') || candidate.includes('..\\') || candidate === '..') {
    throw new McpError(ERROR_CODES.PATH_VIOLATION, 'Path contains traversal sequence', { candidate });
  }

  let resolvedAllowed;
  try {
    resolvedAllowed = await realpath(allowedDir);
  } catch (err) {
    throw new McpError(ERROR_CODES.PATH_VIOLATION, `Cannot resolve allowed directory: ${err.message}`, { allowedDir });
  }

  const target = resolve(resolvedAllowed, candidate);
  if (target !== resolvedAllowed && !target.startsWith(resolvedAllowed + sep)) {
    throw new McpError(
      ERROR_CODES.PATH_VIOLATION,
      'Path resolves outside allowed directory',
      { candidate, resolved: target, allowedDir: resolvedAllowed }
    );
  }

  return target;
}
