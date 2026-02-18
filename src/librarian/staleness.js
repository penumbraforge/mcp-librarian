/**
 * Flag skills that haven't been updated recently.
 */

const STALE_DAYS = 90;

export function checkStaleness(manifest) {
  const stale = [];
  const now = Date.now();
  const threshold = STALE_DAYS * 24 * 60 * 60 * 1000;

  for (const [name, entry] of Object.entries(manifest?.skills || {})) {
    if (!entry.signedAt) {
      stale.push({ name, reason: 'no_timestamp' });
      continue;
    }
    const age = now - new Date(entry.signedAt).getTime();
    if (age > threshold) {
      stale.push({
        name,
        reason: 'stale',
        daysOld: Math.floor(age / (24 * 60 * 60 * 1000)),
      });
    }
  }

  return stale;
}
