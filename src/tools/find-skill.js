/**
 * find_skill — BM25 search → top-K relevant chunks.
 * Primary tool for intelligent retrieval.
 */

export const definition = {
  name: 'find_skill',
  description: 'Search all skills for the most relevant sections matching your query. Returns ranked chunks (50-300 tokens each). This is the primary way to retrieve skill knowledge — describe what you need.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'What you need help with (e.g., "async error handling patterns", "BullMQ job scheduling")',
      },
      top_k: {
        type: 'number',
        description: 'Number of results to return (default: 5, max: 10)',
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
      return { matches: [], message: 'No matching sections found.' };
    }

    return {
      query,
      matches: results.map((r, i) => ({
        rank: i + 1,
        score: Math.round(r.score * 100) / 100,
        skill: r.meta.skill,
        section: r.meta.heading,
        content: r.meta.body,
      })),
    };
  };
}
