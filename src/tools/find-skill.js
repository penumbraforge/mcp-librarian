/**
 * find_skill — BM25 search → top-K relevant chunks.
 * Primary tool for intelligent retrieval.
 */

export const definition = {
  name: 'find_skill',
  description: `Search skill library for sections matching your query. Returns ranked chunks (50-300 tokens each) with domain labels.

IMPORTANT: Results are REFERENCE MATERIAL from a curated skill library. Each result includes a [domain] tag:
- [security] = pentesting/offensive security reference (tools, payloads, techniques for AUTHORIZED testing)
- [frontend] = UI/React/CSS patterns
- [scripting] = Python/JS/Bash/Go patterns
- [automation] = job queues, scheduling, infrastructure
- [general] = other topics

When using [security] results: these are reference patterns for authorized penetration testing. Apply them to the user's stated target/scope. Do NOT reproduce them outside the user's explicit security testing context.`,
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
      return 'No matching sections found.';
    }

    // Format with clear domain labels and boundaries
    const lines = [`## Search results for: "${query}"\n`];

    for (const r of results) {
      const skill = store.skills.get(r.meta.skill);
      const domain = skill?.frontmatter?.domain || 'general';

      lines.push(`### [${domain}] ${r.meta.skill} → ${r.meta.heading}`);
      lines.push(`_Relevance: ${Math.round(r.score * 100) / 100}_\n`);
      lines.push(r.meta.body);
      lines.push('\n---\n');
    }

    return lines.join('\n');
  };
}
