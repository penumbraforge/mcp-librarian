# vhs tape for the mcp-librarian demo GIF.
# Render with:  vhs demo/librarian.tape   (https://github.com/charmbracelet/vhs)
# Produces demo/librarian.gif — signing + tamper-detection over the real
# JSON-RPC interface (mcp-librarian is a stdio MCP server, not a subcommand CLI).

Output demo/librarian.gif
Output demo/librarian.mp4
Output demo/librarian.webm

Set FontSize 17
Set Width 1200
Set Height 560
Set Padding 24
# Penumbra Eclipse — palette from penumbraforge.com design tokens.
Set Theme { "name": "Penumbra Eclipse", "background": "#0a0a14", "foreground": "#e8e4ef", "cursor": "#d4c4f0", "selection": "#2e2e50", "black": "#10101c", "red": "#e0809b", "green": "#6bcf8f", "yellow": "#d9c58a", "blue": "#7d93a8", "magenta": "#b8a5d6", "cyan": "#8fc4cf", "white": "#e8e4ef", "brightBlack": "#5f5a6b", "brightRed": "#eda0b5", "brightGreen": "#8fdfab", "brightYellow": "#e8d9a8", "brightBlue": "#9db3c8", "brightMagenta": "#d4c4f0", "brightCyan": "#aed8e0", "brightWhite": "#f2eff8" }

Type "# mcp-librarian: a signed skill supply chain for AI agents"
Enter
Sleep 1s

Type "# Sign every installed skill (Ed25519):"
Enter
Sleep 600ms
Type "node bin/mcp-librarian.js sign"
Enter
Sleep 2s

Type "# Ask the server for a skill's integrity via JSON-RPC:"
Enter
Sleep 600ms
Type `printf '%s\n' '{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"demo","version":"1"}}}' '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"skill_status","arguments":{"skill":"security-hardening"}}}' | node bin/mcp-librarian.js 2>/dev/null | grep -oE 'VERIFIED|TAMPERED'`
Enter
Sleep 2500ms

Type "# Now tamper with the signed file..."
Enter
Sleep 600ms
Type 'echo "malicious edit" >> ~/.mcp-librarian/skills/security-hardening.md'
Enter
Sleep 1s

Type "# ...and the server reports TAMPERED on the next load. Never served silently:"
Enter
Sleep 600ms
Type `printf '%s\n' '{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"demo","version":"1"}}}' '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"skill_status","arguments":{"skill":"security-hardening"}}}' | node bin/mcp-librarian.js 2>/dev/null | grep -oE 'VERIFIED|TAMPERED'`
Enter
Sleep 3s

Type "# Deterministic integrity. Zero dependencies. Built for the agent era."
Enter
Sleep 2500ms
