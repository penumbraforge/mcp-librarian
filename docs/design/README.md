# Design history

These plans and specs document the evolution of mcp-librarian, including the
rewrite that produced the current architecture.

The project has two ancestral lineages that were developed in parallel and
briefly shared the same GitHub remote:

- **UDS lineage** (`legacy/uds-lineage`, `legacy/npm-launch` branches, tag
  `v3.0.0`): the original Unix-domain-socket server with HMAC auth, RBAC, an
  append-only audit log, Ollama-based AI curation, and quality-weighted
  retrieval. Superseded, preserved for history.
- **stdio lineage** (this `main`): the direct stdio NDJSON MCP server — 14
  tools, BM25 + progressive disclosure, Ed25519 signing, content guard. This
  is the shipped product.

Quality-weighted retrieval was designed in the UDS lineage
(`2026-03-28-quality-weighted-retrieval*`) and has been ported forward into
this codebase (`src/store/quality-scorer.js`, `src/store/source-reputation.js`).

These documents are historical; where they conflict with the current code, the
code wins.
