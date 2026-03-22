/**
 * Minimal argument parser for CLI subcommands.
 * No dependencies. Supports --flag, --key value, and positional args.
 */

const VALID_COMMANDS = [
  'setup', 'start', 'stop', 'restart', 'status',
  'uninstall', 'install-pack', 'update-pack', 'list-packs',
  'remove-pack', 'create-skill', 'export-pack', 'help', 'version',
];

// Flags that take a value argument (not boolean)
const VALUE_FLAGS = ['only'];

export function parseArgs(argv) {
  if (argv.length === 0) return { command: 'help', flags: {}, args: [] };

  const command = VALID_COMMANDS.includes(argv[0]) ? argv[0] : 'help';
  const flags = {};
  const args = [];

  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      if (VALUE_FLAGS.includes(key) && i + 1 < argv.length) {
        flags[key] = argv[++i];
      } else {
        flags[key] = true;
      }
    } else {
      args.push(arg);
    }
  }

  return { command, flags, args };
}
