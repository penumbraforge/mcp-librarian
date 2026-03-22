import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('service', () => {
  it('detectPlatform returns darwin or linux', async () => {
    const { detectPlatform } = await import('../src/cli/service.js');
    const platform = detectPlatform();
    assert.ok(['darwin', 'linux'].includes(platform));
  });

  it('getPlistPath returns a valid path', async () => {
    const { getPlistPath } = await import('../src/cli/service.js');
    const result = getPlistPath();
    assert.ok(result.includes('LaunchAgents') || result.includes('systemd'));
  });
});
