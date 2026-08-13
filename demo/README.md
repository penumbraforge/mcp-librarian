# Demo assets

`librarian.tape` is a [vhs](https://github.com/charmbracelet/vhs) script that
renders `librarian.gif` — a reproducible terminal recording of the
tamper-rejection flow.

To (re)generate the GIF after a change:

```bash
brew install vhs        # one-time
vhs demo/librarian.tape # writes demo/librarian.gif
```

Committing the `.tape` rather than only the `.gif` keeps the demo
reproducible: re-record it any time the CLI output changes.

> Note: mcp-librarian is a stdio MCP server, not a subcommand CLI — the tape
> drives it over raw JSON-RPC via `node bin/mcp-librarian.js`, so render from
> a repo clone. It also re-signs and tampers with the *installed* skill at
> `~/.mcp-librarian/skills/security-hardening.md`; restore that file (and
> re-run `node bin/mcp-librarian.js sign`) after rendering.
