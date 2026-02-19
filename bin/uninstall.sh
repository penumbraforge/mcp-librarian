#!/usr/bin/env bash
set -euo pipefail

# mcp-librarian uninstaller
# Cleanly removes all runtime files, MCP client configs, and launchd service.
# Does NOT delete the repo itself — that's left to the user.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LIB_DIR="$HOME/.mcp-librarian"
PLIST_DEST="$HOME/Library/LaunchAgents/com.mcp-librarian.server.plist"

RED='\033[0;31m'
GREEN='\033[0;32m'
DIM='\033[2m'
BOLD='\033[1m'
RESET='\033[0m'

echo ""
echo -e "  ${BOLD}MCP Librarian — Uninstaller${RESET}"
echo -e "  ${DIM}This will remove all librarian runtime files and configs.${RESET}"
echo ""

# Confirm unless --yes flag passed
if [[ "${1:-}" != "--yes" && "${1:-}" != "-y" ]]; then
  echo -e "  ${RED}This will permanently delete:${RESET}"
  echo "    - $LIB_DIR (keys, secrets, audit log, socket)"
  echo "    - launchd service (com.mcp-librarian.server)"
  echo "    - MCP server configs in Claude Code, cclocal, Crush"
  echo ""
  echo -n "  Continue? [y/N] "
  read -r answer
  if [[ "$answer" != "y" && "$answer" != "Y" ]]; then
    echo "  Aborted."
    exit 0
  fi
fi

echo ""

# 1. Stop launchd service
echo "[1/5] Stopping launchd service..."
if [ -f "$PLIST_DEST" ]; then
  launchctl unload "$PLIST_DEST" 2>/dev/null || true
  rm -f "$PLIST_DEST"
  echo -e "  ${GREEN}Removed${RESET} $PLIST_DEST"
else
  echo "  Not found, skipping"
fi

# 2. Kill any running server
echo "[2/5] Stopping running server..."
if [ -S "$LIB_DIR/librarian.sock" ]; then
  # Find server PID via socket
  pkill -f "mcp-librarian.js" 2>/dev/null && echo -e "  ${GREEN}Server stopped${RESET}" || echo "  No server running"
  sleep 1
else
  echo "  No socket found"
fi

# 3. Remove MCP client configs
echo "[3/5] Removing MCP client configs..."

# Claude Code
if command -v claude &>/dev/null; then
  env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT claude mcp remove --scope user librarian 2>/dev/null && \
    echo -e "  ${GREEN}Claude Code${RESET}: removed from ~/.claude.json" || \
    echo "  Claude Code: not configured or already removed"
else
  # Manual removal from ~/.claude.json
  CLAUDE_JSON="$HOME/.claude.json"
  if [ -f "$CLAUDE_JSON" ]; then
    node --input-type=module -e "
      import { readFileSync, writeFileSync } from 'node:fs';
      const path = process.argv[1];
      const config = JSON.parse(readFileSync(path, 'utf8'));
      if (config.mcpServers?.librarian) {
        delete config.mcpServers.librarian;
        writeFileSync(path, JSON.stringify(config, null, 2) + '\n');
        console.log('  Claude Code: removed from ' + path);
      } else {
        console.log('  Claude Code: not configured');
      }
    " "$CLAUDE_JSON" 2>/dev/null || echo "  Claude Code: manual cleanup needed"
  fi
fi

# cclocal
CCLOCAL_JSON="$HOME/.claude-local/claude.json"
if [ -f "$CCLOCAL_JSON" ]; then
  node --input-type=module -e "
    import { readFileSync, writeFileSync } from 'node:fs';
    const path = process.argv[1];
    const homeKey = process.env.HOME || '/Users/' + process.env.USER;
    const config = JSON.parse(readFileSync(path, 'utf8'));
    let removed = false;
    if (config.projects?.[homeKey]?.mcpServers?.librarian) {
      delete config.projects[homeKey].mcpServers.librarian;
      removed = true;
    }
    // Also check top-level mcpServers
    if (config.mcpServers?.librarian) {
      delete config.mcpServers.librarian;
      removed = true;
    }
    if (removed) {
      writeFileSync(path, JSON.stringify(config, null, 2) + '\n');
      console.log('  cclocal: removed from ' + path);
    } else {
      console.log('  cclocal: not configured');
    }
  " "$CCLOCAL_JSON" 2>/dev/null || echo "  cclocal: manual cleanup needed"
else
  echo "  cclocal: not found, skipping"
fi

# Crush
CRUSH_CONFIG="$HOME/.config/crush/config.json"
if [ -f "$CRUSH_CONFIG" ]; then
  node --input-type=module -e "
    import { readFileSync, writeFileSync } from 'node:fs';
    const path = process.argv[1];
    const config = JSON.parse(readFileSync(path, 'utf8'));
    if (config.mcpServers?.librarian) {
      delete config.mcpServers.librarian;
      writeFileSync(path, JSON.stringify(config, null, 2) + '\n');
      console.log('  Crush: removed from ' + path);
    } else {
      console.log('  Crush: not configured');
    }
  " "$CRUSH_CONFIG" 2>/dev/null || echo "  Crush: manual cleanup needed"
else
  echo "  Crush: not found, skipping"
fi

# 4. Delete runtime directory (keys, secrets, audit log, socket)
echo "[4/5] Removing runtime directory..."
if [ -d "$LIB_DIR" ]; then
  rm -rf "$LIB_DIR"
  echo -e "  ${GREEN}Removed${RESET} $LIB_DIR"
else
  echo "  Not found"
fi

# 5. Summary
echo "[5/5] Cleanup complete."
echo ""
echo -e "  ${GREEN}MCP Librarian has been fully uninstalled.${RESET}"
echo ""
echo -e "  ${DIM}The repository at $PROJECT_DIR was NOT deleted.${RESET}"
echo -e "  ${DIM}To remove it:  rm -rf $PROJECT_DIR${RESET}"
echo ""
