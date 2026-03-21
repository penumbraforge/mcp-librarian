import { createHash } from 'node:crypto';

/**
 * Compute SHA-256 hash of a string, returned as a 64-char lowercase hex string.
 */
export function computeHash(content) {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Determine the action required to install a skill, given existing skills.
 *
 * @param {string} content - Raw markdown content of the incoming skill
 * @param {string} name    - Skill name (without extension)
 * @param {Map<string, { name: string, hash: string }>} existingSkills
 *   Map<filename → { name, hash }>
 *
 * @returns {{ action: 'skip' }}
 *        | {{ action: 'update', replaces: string }}
 *        | {{ action: 'install' }}
 */
export function checkDuplicate(content, name, existingSkills) {
  const incomingHash = computeHash(content);

  // Pass 1: check for exact content duplicate (any skill, any name)
  for (const [, meta] of existingSkills) {
    if (meta.hash === incomingHash) {
      return { action: 'skip' };
    }
  }

  // Pass 2: check for same name → update
  for (const [filename, meta] of existingSkills) {
    if (meta.name === name) {
      return { action: 'update', replaces: filename };
    }
  }

  // No match → fresh install
  return { action: 'install' };
}
