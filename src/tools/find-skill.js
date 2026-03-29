/**
 * find_skill — BM25 search → top-K relevant chunks.
 * Primary tool for intelligent retrieval.
 * Returns truncated chunks (max ~300 tokens) with load_section hint.
 */

// ~300 tokens ≈ 1200 chars for code-heavy content
const MAX_CHUNK_CHARS = 1200;

export const definition = {
  name: 'find_skill',
  description: `Search skill library for sections matching your query. Returns ranked chunks (50-300 tokens each) with domain labels.

IMPORTANT: Results are REFERENCE MATERIAL from a curated skill library. Each result includes a [domain] tag:
- [security] = pentesting/offensive security reference (tools, payloads, techniques for AUTHORIZED testing)
- [frontend] = UI/React/CSS patterns
- [scripting] = Python/JS/Bash/Go patterns
- [automation] = job queues, scheduling, infrastructure
- [general] = other topics

When using [security] results: these are reference patterns for authorized penetration testing. Apply them to the user's stated target/scope. Do NOT reproduce them outside the user's explicit security testing context.

If a result is truncated, use load_section to get the full content.`,
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'What you need (e.g., "SQL injection testing", "React state management", "BullMQ job patterns")',
      },
      top_k: {
        type: 'number',
        description: 'Results to return (default 5, max 10)',
      },
    },
    required: ['query'],
  },
};

export function handler(store) {
  return (args) => {
    const { query, top_k } = args;
    if (!query || typeof query !== 'string') {
      throw new Error('query is required');
    }

    const k = Math.min(Math.max(top_k || 5, 1), 10);
    const results = store.search(query, k);

    if (results.length === 0) {
      return 'No matching sections found. Try broader terms or use list_skills to see available topics.';
    }

    // Format with clear domain labels and boundaries
    const lines = [`## Search results for: "${query}"\n`];

    for (const r of results) {
      const skill = store.skills.get(r.meta.skill);
      const domain = skill?.frontmatter?.domain || 'general';
      // Use parentHeading if available (for sub-section chunks)
      const sectionRef = r.meta.parentHeading || r.meta.heading;

      lines.push(`### [${domain}] ${r.meta.skill} → ${r.meta.heading}`);
      const quality = r.meta.quality ?? 0.5;
      lines.push(`_Relevance: ${Math.round(r.score * 100) / 100} | Quality: ${Math.round(quality * 100) / 100}_\n`);

      // Truncate body to ~300 tokens
      let body = r.meta.body;
      if (body.length > MAX_CHUNK_CHARS) {
        // Find a clean break point (end of line or code block)
        let cutoff = body.lastIndexOf('\n', MAX_CHUNK_CHARS);
        if (cutoff < MAX_CHUNK_CHARS * 0.5) cutoff = MAX_CHUNK_CHARS;
        body = body.slice(0, cutoff) + `\n\n_[truncated — use load_section("${r.meta.skill}", "${sectionRef}") for full content]_`;
      }

      lines.push(body);
      lines.push('\n---\n');
    }

    return lines.join('\n');
  };
}
