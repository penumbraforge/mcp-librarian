/**
 * Platform service management — launchd (macOS) and systemd (Linux).
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir, platform as osPlatform } from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getLibDir, getPidPath, getSocketPath } from './paths.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(__dirname, '..', '..');

const PLIST_LABEL = 'com.mcp-librarian.server';
const SYSTEMD_UNIT = 'mcp-librarian.service';

export function detectPlatform() {
  return osPlatform();
}

export function getPlistPath() {
  if (osPlatform() === 'darwin') {
    return join(homedir(), 'Library', 'LaunchAgents', `${PLIST_LABEL}.plist`);
  }
  return join(homedir(), '.config', 'systemd', 'user', SYSTEMD_UNIT);
}

export async function installService() {
  const platform = detectPlatform();
  if (platform === 'darwin') {
    await installLaunchd();
  } else if (platform === 'linux') {
    await installSystemd();
  } else {
    console.log('  Service install not supported on this platform');
    console.log('  Run manually: mcp-librarian start');
  }
}

async function installLaunchd() {
  const plistDest = getPlistPath();
  const nodePath = process.execPath;
  const cliPath = join(PACKAGE_ROOT, 'bin', 'cli.js');
  const libDir = getLibDir();

  // Unload old plist if present
  if (existsSync(plistDest)) {
    try { execSync(`launchctl unload "${plistDest}" 2>/dev/null`); } catch {}
  }

  // Generate plist directly (3-arg ProgramArguments: node, cli.js, start)
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>Label</key>
\t<string>${PLIST_LABEL}</string>
\t<key>ProgramArguments</key>
\t<array>
\t\t<string>${nodePath}</string>
\t\t<string>${cliPath}</string>
\t\t<string>start</string>
\t</array>
\t<key>RunAtLoad</key>
\t<true/>
\t<key>KeepAlive</key>
\t<true/>
\t<key>StandardOutPath</key>
\t<string>${libDir}/server.log</string>
\t<key>StandardErrorPath</key>
\t<string>${libDir}/server.err</string>
\t<key>WorkingDirectory</key>
\t<string>${libDir}</string>
\t<key>EnvironmentVariables</key>
\t<dict>
\t\t<key>PATH</key>
\t\t<string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
\t</dict>
</dict>
</plist>
`;

  writeFileSync(plistDest, plist);

  try {
    execSync(`launchctl load "${plistDest}"`);
    console.log(`  launchd: loaded ${PLIST_LABEL}`);
  } catch {
    console.log(`  launchd: plist installed at ${plistDest}`);
    console.log(`  Run: launchctl load "${plistDest}"`);
  }
}

async function installSystemd() {
  const templatePath = join(PACKAGE_ROOT, 'config', 'systemd.service.template');
  const unitDir = join(homedir(), '.config', 'systemd', 'user');
  const unitPath = join(unitDir, SYSTEMD_UNIT);
  const nodePath = process.execPath;
  const cliPath = join(PACKAGE_ROOT, 'bin', 'cli.js');

  let template = readFileSync(templatePath, 'utf8');
  template = template
    .replace('__NODE_PATH__', nodePath)
    .replace('__CLI_PATH__', cliPath)
    .replace('__LIB_DIR__', getLibDir());

  mkdirSync(unitDir, { recursive: true });
  writeFileSync(unitPath, template);

  try {
    execSync('systemctl --user daemon-reload');
    execSync('systemctl --user enable --now mcp-librarian');
    console.log(`  systemd: enabled and started ${SYSTEMD_UNIT}`);
  } catch {
    console.log(`  systemd: unit installed at ${unitPath}`);
    console.log(`  Run: systemctl --user enable --now mcp-librarian`);
  }
}

export async function stopService() {
  const platform = detectPlatform();

  if (platform === 'darwin') {
    const plistPath = getPlistPath();
    if (existsSync(plistPath)) {
      try { execSync(`launchctl unload "${plistPath}"`); console.log('Service stopped (launchd)'); return; } catch {}
    }
  } else if (platform === 'linux') {
    try { execSync('systemctl --user stop mcp-librarian'); console.log('Service stopped (systemd)'); return; } catch {}
  }

  // Fallback: PID file
  const pidPath = getPidPath();
  if (existsSync(pidPath)) {
    const pid = parseInt(readFileSync(pidPath, 'utf8').trim(), 10);
    try { process.kill(pid, 'SIGTERM'); console.log(`Stopped PID ${pid}`); } catch {}
    try { unlinkSync(pidPath); } catch {}
    return;
  }

  console.log('No running service found');
}

export async function restartService() {
  await stopService();
  await new Promise(r => setTimeout(r, 500));
  const platform = detectPlatform();
  if (platform === 'darwin') {
    const plistPath = getPlistPath();
    if (existsSync(plistPath)) {
      try { execSync(`launchctl load "${plistPath}"`); console.log('Service restarted (launchd)'); return; } catch {}
    }
  } else if (platform === 'linux') {
    try { execSync('systemctl --user start mcp-librarian'); console.log('Service restarted (systemd)'); return; } catch {}
  }
  console.log('No service installed. Run: mcp-librarian start');
}

export async function showStatus() {
  const libDir = getLibDir();
  const socketPath = getSocketPath();
  const pidPath = getPidPath();

  console.log(`\n  \x1b[1mmcp-librarian status\x1b[0m\n`);
  console.log(`  Runtime dir:  ${libDir} ${existsSync(libDir) ? '\x1b[32m(exists)\x1b[0m' : '\x1b[31m(missing)\x1b[0m'}`);
  console.log(`  Socket:       ${socketPath} ${existsSync(socketPath) ? '\x1b[32m(active)\x1b[0m' : '\x1b[33m(not running)\x1b[0m'}`);

  if (existsSync(pidPath)) {
    const pid = readFileSync(pidPath, 'utf8').trim();
    console.log(`  PID:          ${pid}`);
  }

  const platform = detectPlatform();
  if (platform === 'darwin') {
    try {
      execSync(`launchctl list ${PLIST_LABEL} 2>/dev/null`, { encoding: 'utf8' });
      console.log(`  launchd:      \x1b[32mloaded\x1b[0m`);
    } catch {
      console.log(`  launchd:      \x1b[33mnot loaded\x1b[0m`);
    }
  } else if (platform === 'linux') {
    try {
      const out = execSync('systemctl --user is-active mcp-librarian 2>/dev/null', { encoding: 'utf8' });
      console.log(`  systemd:      \x1b[32m${out.trim()}\x1b[0m`);
    } catch {
      console.log(`  systemd:      \x1b[33minactive\x1b[0m`);
    }
  }

  const skillsDir = join(libDir, 'skills');
  if (existsSync(skillsDir)) {
    const count = readdirSync(skillsDir, { withFileTypes: true }).filter(e => e.isDirectory()).length;
    console.log(`  Skills:       ${count}`);
  }

  console.log('');
}
