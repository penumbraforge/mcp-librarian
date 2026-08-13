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

> Note: the tape uses `mcp-librarian skill-status`, which assumes the CLI is on
> PATH (via `npm install -g` or a shell alias). Adjust the commands to
> `node bin/mcp-librarian.js …` if running from a clone.
