import { resolve, relative } from 'node:path';
import { lstatSync, realpathSync } from 'node:fs';

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

  // Resolve the REAL path (follows entire symlink chain) and verify it's still within bounds
  try {
    const realPath = realpathSync(resolved);
    const realBase = realpathSync(allowedBase);
    const realRel = relative(realBase, realPath);
    if (realRel.startsWith('..')) {
      throw new Error(`Symlink target escapes allowed directory: ${requestedPath}`);
    }
    // Also reject if the final target itself is a symlink (belt + suspenders)
    const stat = lstatSync(realPath);
    if (stat.isSymbolicLink()) {
      throw new Error(`Symlinks not allowed: ${requestedPath}`);
    }
    return realPath;
  } catch (e) {
    if (e.code === 'ENOENT') {
      // File doesn't exist yet — validate each existing ancestor isn't a symlink
      let current = resolved;
      const base = realpathSync(allowedBase);
      while (current !== base && current !== resolve(current, '..')) {
        try {
          const stat = lstatSync(current);
          if (stat.isSymbolicLink()) {
            throw new Error(`Symlink in path ancestry: ${requestedPath}`);
          }
          break; // Reached an existing non-symlink ancestor
        } catch (inner) {
          if (inner.code !== 'ENOENT') throw inner;
          current = resolve(current, '..');
        }
      }
      return resolved;
    }
    throw e;
  }
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
