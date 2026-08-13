# vhs tape for the mcp-librarian demo GIF.
# Render with:  vhs demo/librarian.tape   (https://github.com/charmbracelet/vhs)
# Produces demo/librarian.gif — signing + tamper-detection over the real
# JSON-RPC interface (mcp-librarian is a stdio MCP server, not a subcommand CLI).

Output demo/librarian.gif

Set FontSize 17
Set Width 1200
Set Height 720
Set Padding 24
Set Theme "Catppuccin Mocha"

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
Type `printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"skill_status","arguments":{"skill":"security-hardening"}}}' | node bin/mcp-librarian.js | grep -o '"integrity":"[A-Z]*"'`
Enter
Sleep 2500ms

Type "# Now tamper with the signed file..."
Enter
Sleep 600ms
Type 'echo "malicious edit" >> ~/.mcp-librarian/skills/security-hardening.md'
Enter
Sleep 1s

Type "# ...and the server reports TAMPERED on the next load — never served silently:"
Enter
Sleep 600ms
Type `printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"skill_status","arguments":{"skill":"security-hardening"}}}' | node bin/mcp-librarian.js | grep -o '"integrity":"[A-Z]*"'`
Enter
Sleep 3s

Type "# Deterministic integrity. Zero dependencies. Built for the agent era."
Enter
Sleep 2500ms
