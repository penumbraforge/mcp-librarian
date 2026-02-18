import { statSync, chmodSync, mkdirSync } from 'node:fs';

export function ensureDir(dirPath, mode = 0o700) {
  mkdirSync(dirPath, { recursive: true, mode });
  chmodSync(dirPath, mode);
}

export function ensureFilePerms(filePath, mode = 0o600) {
  try {
    chmodSync(filePath, mode);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
}

export function checkPerms(filePath, expectedMode) {
  try {
    const stat = statSync(filePath);
    const actual = stat.mode & 0o777;
    return actual === expectedMode;
  } catch {
    return false;
  }
}

export function checkOwner(filePath) {
  try {
    const stat = statSync(filePath);
    return stat.uid === process.getuid();
  } catch {
    return false;
  }
}
