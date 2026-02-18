import { resolve, relative } from 'node:path';
import { lstatSync } from 'node:fs';

export function validatePath(requestedPath, allowedBase) {
  if (typeof requestedPath !== 'string') {
    throw new Error('Path must be a string');
  }

  // Block null bytes
  if (requestedPath.includes('\0')) {
    throw new Error('Path contains null bytes');
  }

  const resolved = resolve(allowedBase, requestedPath);
  const rel = relative(allowedBase, resolved);

  // Must be within allowedBase (no .. escapes)
  if (rel.startsWith('..') || resolve(resolved) !== resolved) {
    throw new Error(`Path escapes allowed directory: ${requestedPath}`);
  }

  // Check for symlinks pointing outside
  try {
    const stat = lstatSync(resolved);
    if (stat.isSymbolicLink()) {
      throw new Error(`Symlinks not allowed: ${requestedPath}`);
    }
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    // File doesn't exist yet — that's OK for writes
  }

  return resolved;
}

export function sanitizeSkillName(name) {
  if (typeof name !== 'string') throw new Error('Skill name must be a string');
  if (name.includes('\0')) throw new Error('Skill name contains null bytes');
  if (!/^[a-z0-9_-]+$/i.test(name)) {
    throw new Error(`Invalid skill name: ${name}`);
  }
  if (name.length > 64) {
    throw new Error('Skill name too long (max 64)');
  }
  return name;
}
