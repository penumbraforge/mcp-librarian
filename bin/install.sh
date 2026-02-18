#!/usr/bin/env bash
set -euo pipefail

# mcp-librarian installer
# Creates ~/.mcp-librarian, generates keys + secrets, migrates skills, signs manifest,
# configures Claude Code / cclocal / Crush for fresh install

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LIB_DIR="$HOME/.mcp-librarian"
SKILLS_DIR="$PROJECT_DIR/skills"
CLAWLET_SKILLS="$HOME/.clawlet/workspace/skills"
NODE_PATH=$(which node)

echo "=== MCP Librarian Installer ==="
echo "Project:  $PROJECT_DIR"
echo "Runtime:  $LIB_DIR"
echo "Node:     $NODE_PATH"

# 1. Create runtime directory
echo ""
echo "[1/8] Creating runtime directory..."
mkdir -p "$LIB_DIR"
chmod 700 "$LIB_DIR"

# 2. Generate Ed25519 keypair
echo "[2/8] Generating Ed25519 keypair..."
if [ ! -f "$LIB_DIR/ed25519.priv" ]; then
  node --input-type=module -e "
    import { generateKeyPairSync } from 'node:crypto';
    import { writeFileSync } from 'node:fs';
    import { join } from 'node:path';
    const dir = process.argv[1];
    const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    writeFileSync(join(dir, 'ed25519.pub'), publicKey, { mode: 0o600 });
    writeFileSync(join(dir, 'ed25519.priv'), privateKey, { mode: 0o600 });
    console.log('  Ed25519 keypair generated');
  " "$LIB_DIR"
else
  echo "  Keypair already exists, skipping"
fi

# 3. Generate HMAC secrets
echo "[3/8] Generating HMAC secrets..."
if [ ! -f "$LIB_DIR/client.secret" ]; then
  node --input-type=module -e "
    import { randomBytes } from 'node:crypto';
    import { writeFileSync } from 'node:fs';
    import { join } from 'node:path';
    const dir = process.argv[1];
    writeFileSync(join(dir, 'client.secret'), randomBytes(32).toString('hex'), { mode: 0o600 });
    writeFileSync(join(dir, 'librarian.secret'), randomBytes(32).toString('hex'), { mode: 0o600 });
    console.log('  Client + librarian secrets generated');
  " "$LIB_DIR"
else
  echo "  Secrets already exist, skipping"
fi

# 4. Migrate skills from clawlet
echo "[4/8] Migrating skills..."
if [ -d "$CLAWLET_SKILLS" ]; then
  for skill_dir in "$CLAWLET_SKILLS"/*/; do
    skill_name=$(basename "$skill_dir")
    skill_file="$skill_dir/SKILL.md"
    if [ -f "$skill_file" ]; then
      dest="$SKILLS_DIR/$skill_name"
      if [ ! -d "$dest" ]; then
        mkdir -p "$dest"
        cp "$skill_file" "$dest/SKILL.md"
        echo "  Migrated: $skill_name"
      else
        echo "  Already exists: $skill_name"
      fi
    fi
  done
else
  echo "  No clawlet skills found, skipping"
fi

# 5. Ensure frontmatter on all skills
echo "[5/8] Validating skill frontmatter..."
for skill_dir in "$SKILLS_DIR"/*/; do
  skill_name=$(basename "$skill_dir")
  skill_file="$skill_dir/SKILL.md"
  if [ -f "$skill_file" ]; then
    if ! head -1 "$skill_file" | grep -q "^---"; then
      echo "  Adding frontmatter to: $skill_name"
      tmpfile=$(mktemp)
      cat > "$tmpfile" <<YAML
---
name: $skill_name
description: "$skill_name skill"
domain: general
version: "1.0"
---

YAML
      cat "$skill_file" >> "$tmpfile"
      mv "$tmpfile" "$skill_file"
    fi
  fi
done

# 6. Sign all skills
echo "[6/8] Signing skill manifest..."
node --input-type=module -e "
  import { readdirSync, readFileSync, existsSync } from 'node:fs';
  import { join } from 'node:path';
  import { IntegrityEngine } from './src/librarian/integrity.js';

  const skillsDir = process.argv[1];
  const libDir = process.argv[2];

  const pubKey = readFileSync(join(libDir, 'ed25519.pub'), 'utf8');
  const privKey = readFileSync(join(libDir, 'ed25519.priv'), 'utf8');

  const engine = new IntegrityEngine(skillsDir, pubKey, privKey);
  const contents = {};

  const entries = readdirSync(skillsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillPath = join(skillsDir, entry.name, 'SKILL.md');
    if (existsSync(skillPath)) {
      contents[entry.name] = readFileSync(skillPath, 'utf8');
    }
  }

  const manifest = engine.signAll(contents);
  console.log('  Signed ' + Object.keys(manifest.skills).length + ' skills');
" "$SKILLS_DIR" "$LIB_DIR"

# 7. Configure MCP clients
echo "[7/8] Configuring MCP clients..."

STDIO_PATH="$PROJECT_DIR/bin/mcp-librarian-stdio.js"

# Claude Code — use `claude mcp add` if available, else edit JSON directly
if command -v claude &>/dev/null; then
  claude mcp add --scope user librarian -- "$NODE_PATH" "$STDIO_PATH" 2>/dev/null && \
    echo "  Claude Code: configured via CLI" || \
    echo "  Claude Code: CLI config failed, configure manually"
else
  echo "  Claude Code: 'claude' CLI not found, configure manually:"
  echo "    claude mcp add --scope user librarian -- $NODE_PATH $STDIO_PATH"
fi

# cclocal — edit ~/.claude-local/claude.json directly (no CLI in local mode)
CCLOCAL_DIR="$HOME/.claude-local"
if [ -d "$CCLOCAL_DIR" ]; then
  CCLOCAL_JSON="$CCLOCAL_DIR/claude.json"
  node --input-type=module -e "
    import { readFileSync, writeFileSync, existsSync } from 'node:fs';
    const path = process.argv[1];
    const nodePath = process.argv[2];
    const stdioPath = process.argv[3];

    let config = {};
    if (existsSync(path)) {
      try { config = JSON.parse(readFileSync(path, 'utf8')); } catch {}
    }

    // Ensure projects structure
    if (!config.projects) config.projects = {};
    const homeKey = process.env.HOME || '/Users/' + process.env.USER;
    if (!config.projects[homeKey]) config.projects[homeKey] = {};
    if (!config.projects[homeKey].mcpServers) config.projects[homeKey].mcpServers = {};

    config.projects[homeKey].mcpServers.librarian = {
      type: 'stdio',
      command: nodePath,
      args: [stdioPath],
    };

    writeFileSync(path, JSON.stringify(config, null, 2) + '\n');
    console.log('  cclocal: configured at ' + path);
  " "$CCLOCAL_JSON" "$NODE_PATH" "$STDIO_PATH"
else
  echo "  cclocal: ~/.claude-local not found, skipping"
fi

# Crush — update config if it exists
CRUSH_CONFIG="$HOME/.config/crush/config.json"
if [ -f "$CRUSH_CONFIG" ]; then
  node --input-type=module -e "
    import { readFileSync, writeFileSync } from 'node:fs';
    const path = process.argv[1];
    const nodePath = process.argv[2];
    const stdioPath = process.argv[3];

    let config = JSON.parse(readFileSync(path, 'utf8'));
    if (!config.mcpServers) config.mcpServers = {};

    config.mcpServers.librarian = {
      command: nodePath,
      args: [stdioPath],
    };

    writeFileSync(path, JSON.stringify(config, null, 2) + '\n');
    console.log('  Crush: configured at ' + path);
  " "$CRUSH_CONFIG" "$NODE_PATH" "$STDIO_PATH"
else
  echo "  Crush: config not found, skipping"
fi

# 8. Setup launchd plist
echo "[8/8] Configuring launchd..."
PLIST_SRC="$PROJECT_DIR/config/com.mcp-librarian.server.plist"
PLIST_DEST="$HOME/Library/LaunchAgents/com.mcp-librarian.server.plist"

if [ -f "$PLIST_SRC" ]; then
  sed \
    -e "s|__PROJECT_DIR__|$PROJECT_DIR|g" \
    -e "s|__HOME__|$HOME|g" \
    -e "s|/usr/local/bin/node|$NODE_PATH|g" \
    "$PLIST_SRC" > "$PLIST_DEST"
  echo "  Plist: $PLIST_DEST"
  echo "  Start: launchctl load $PLIST_DEST"
fi

# Clean up old mcp-forge if it exists
OLD_PLIST="$HOME/Library/LaunchAgents/com.mcp-forge.server.plist"
if [ -f "$OLD_PLIST" ]; then
  launchctl unload "$OLD_PLIST" 2>/dev/null || true
  rm -f "$OLD_PLIST"
  echo "  Removed old mcp-forge plist"
fi
if [ -d "$HOME/.mcp-forge" ]; then
  echo "  Note: old ~/.mcp-forge directory still exists. Remove manually if no longer needed."
fi

# Verify permissions
echo ""
echo "=== Permissions ==="
for f in "$LIB_DIR"/ed25519.* "$LIB_DIR"/*.secret; do
  if [ -f "$f" ]; then
    perms=$(stat -f %Lp "$f" 2>/dev/null || stat -c %a "$f" 2>/dev/null)
    echo "  $(basename "$f"): $perms"
  fi
done

echo ""
echo "=== Done ==="
echo "Start:     node $PROJECT_DIR/bin/mcp-librarian.js"
echo "Test:      node --test $PROJECT_DIR/test/test-*.js"
echo "Auto-start: launchctl load $PLIST_DEST"
