import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('paths', () => {
  it('resolves LIB_DIR to ~/.mcp-librarian by default', async () => {
    const { getLibDir } = await import('../src/cli/paths.js');
    const { homedir } = await import('node:os');
    const { join } = await import('node:path');
    assert.equal(getLibDir(), join(homedir(), '.mcp-librarian'));
  });

  it('resolves SKILLS_DIR under LIB_DIR', async () => {
    const { getSkillsDir } = await import('../src/cli/paths.js');
    const { homedir } = await import('node:os');
    const { join } = await import('node:path');
    assert.equal(getSkillsDir(), join(homedir(), '.mcp-librarian', 'skills'));
  });

  it('resolves PACKS_DIR under LIB_DIR', async () => {
    const { getPacksDir } = await import('../src/cli/paths.js');
    const { homedir } = await import('node:os');
    const { join } = await import('node:path');
    assert.equal(getPacksDir(), join(homedir(), '.mcp-librarian', 'packs'));
  });

  it('resolves STAGING_DIR under LIB_DIR', async () => {
    const { getStagingDir } = await import('../src/cli/paths.js');
    const { homedir } = await import('node:os');
    const { join } = await import('node:path');
    assert.equal(getStagingDir(), join(homedir(), '.mcp-librarian', 'staging'));
  });

  it('returns bundled skills dir relative to package root', async () => {
    const { getBundledSkillsDir } = await import('../src/cli/paths.js');
    const result = getBundledSkillsDir();
    assert.ok(result.endsWith('/skills') || result.endsWith('\\skills'));
  });
});
