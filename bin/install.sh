#!/usr/bin/env bash
set -euo pipefail

# mcp-forge installer
# Creates ~/.mcp-forge, generates keys + secrets, migrates skills, signs manifest

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
FORGE_DIR="$HOME/.mcp-forge"
SKILLS_DIR="$PROJECT_DIR/skills"
CLAWLET_SKILLS="$HOME/.clawlet/workspace/skills"

echo "=== MCP Forge Installer ==="
echo "Project: $PROJECT_DIR"
echo "Runtime: $FORGE_DIR"

# 1. Create runtime directory
echo ""
echo "[1/7] Creating runtime directory..."
mkdir -p "$FORGE_DIR"
chmod 700 "$FORGE_DIR"

# 2. Generate Ed25519 keypair
echo "[2/7] Generating Ed25519 keypair..."
if [ ! -f "$FORGE_DIR/ed25519.priv" ]; then
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
  " "$FORGE_DIR"
else
  echo "  Keypair already exists, skipping"
fi

# 3. Generate HMAC secrets
echo "[3/7] Generating HMAC secrets..."
if [ ! -f "$FORGE_DIR/client.secret" ]; then
  node --input-type=module -e "
    import { randomBytes } from 'node:crypto';
    import { writeFileSync } from 'node:fs';
    import { join } from 'node:path';
    const dir = process.argv[1];
    writeFileSync(join(dir, 'client.secret'), randomBytes(32).toString('hex'), { mode: 0o600 });
    writeFileSync(join(dir, 'librarian.secret'), randomBytes(32).toString('hex'), { mode: 0o600 });
    console.log('  Client + librarian secrets generated');
  " "$FORGE_DIR"
else
  echo "  Secrets already exist, skipping"
fi

# 4. Migrate skills from clawlet
echo "[4/7] Migrating skills..."
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
  echo "  No clawlet skills found at $CLAWLET_SKILLS"
fi

# 5. Add frontmatter to skills that lack it
echo "[5/7] Ensuring frontmatter..."
for skill_dir in "$SKILLS_DIR"/*/; do
  skill_name=$(basename "$skill_dir")
  skill_file="$skill_dir/SKILL.md"
  if [ -f "$skill_file" ]; then
    # Check if file starts with ---
    if ! head -1 "$skill_file" | grep -q "^---"; then
      echo "  Adding frontmatter to: $skill_name"
      tmpfile=$(mktemp)
      cat > "$tmpfile" <<YAML
---
name: $skill_name
description: $skill_name skill
---

YAML
      cat "$skill_file" >> "$tmpfile"
      mv "$tmpfile" "$skill_file"
    fi
  fi
done

# 6. Sign all skills
echo "[6/7] Signing skills..."
node --input-type=module -e "
  import { readdirSync, readFileSync, existsSync } from 'node:fs';
  import { join } from 'node:path';
  import { IntegrityEngine } from './src/librarian/integrity.js';

  const skillsDir = process.argv[1];
  const forgeDir = process.argv[2];

  const pubKey = readFileSync(join(forgeDir, 'ed25519.pub'), 'utf8');
  const privKey = readFileSync(join(forgeDir, 'ed25519.priv'), 'utf8');

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
" "$SKILLS_DIR" "$FORGE_DIR"

# 7. Setup launchd plist
echo "[7/7] Configuring launchd..."
NODE_PATH=$(which node)
PLIST_SRC="$PROJECT_DIR/config/com.mcp-forge.server.plist"
PLIST_DEST="$HOME/Library/LaunchAgents/com.mcp-forge.server.plist"

if [ -f "$PLIST_SRC" ]; then
  sed \
    -e "s|__MCP_FORGE_DIR__|$PROJECT_DIR|g" \
    -e "s|__HOME__|$HOME|g" \
    -e "s|/usr/local/bin/node|$NODE_PATH|g" \
    "$PLIST_SRC" > "$PLIST_DEST"
  echo "  Plist installed to $PLIST_DEST"
  echo "  Run: launchctl load $PLIST_DEST"
else
  echo "  Plist template not found, skipping"
fi

# Verify permissions
echo ""
echo "=== Verifying permissions ==="
for f in "$FORGE_DIR"/ed25519.* "$FORGE_DIR"/*.secret; do
  if [ -f "$f" ]; then
    perms=$(stat -f %Lp "$f" 2>/dev/null || stat -c %a "$f" 2>/dev/null)
    echo "  $(basename "$f"): $perms"
  fi
done

echo ""
echo "=== Installation complete ==="
echo "Start server:  node $PROJECT_DIR/bin/mcp-forge.js"
echo "Run tests:     node --test $PROJECT_DIR/test/"
echo "Auto-start:    launchctl load $PLIST_DEST"
