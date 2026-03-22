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

describe('CLI parser', () => {
  it('parses setup command', async () => {
    const { parseArgs } = await import('../src/cli/parse-args.js');
    const result = parseArgs(['setup']);
    assert.equal(result.command, 'setup');
    assert.deepEqual(result.flags, {});
  });

  it('parses setup with flags', async () => {
    const { parseArgs } = await import('../src/cli/parse-args.js');
    const result = parseArgs(['setup', '--dry-run', '--skip-clients']);
    assert.equal(result.command, 'setup');
    assert.equal(result.flags['dry-run'], true);
    assert.equal(result.flags['skip-clients'], true);
  });

  it('parses setup --only with value', async () => {
    const { parseArgs } = await import('../src/cli/parse-args.js');
    const result = parseArgs(['setup', '--only', 'claude-code']);
    assert.equal(result.flags.only, 'claude-code');
  });

  it('parses install-pack with positional arg', async () => {
    const { parseArgs } = await import('../src/cli/parse-args.js');
    const result = parseArgs(['install-pack', 'penumbraforge/starter']);
    assert.equal(result.command, 'install-pack');
    assert.deepEqual(result.args, ['penumbraforge/starter']);
  });

  it('parses start command', async () => {
    const { parseArgs } = await import('../src/cli/parse-args.js');
    const result = parseArgs(['start']);
    assert.equal(result.command, 'start');
  });

  it('defaults to help with no args', async () => {
    const { parseArgs } = await import('../src/cli/parse-args.js');
    const result = parseArgs([]);
    assert.equal(result.command, 'help');
  });

  it('parses uninstall --yes', async () => {
    const { parseArgs } = await import('../src/cli/parse-args.js');
    const result = parseArgs(['uninstall', '--yes']);
    assert.equal(result.command, 'uninstall');
    assert.equal(result.flags.yes, true);
  });
});
