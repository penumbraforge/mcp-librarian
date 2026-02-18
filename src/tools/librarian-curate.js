/**
 * librarian_curate — Trigger AI curation (librarian role only).
 */

export const definition = {
  name: 'librarian_curate',
  description: 'Trigger AI-powered skill curation. Librarian role only. Actions: analyze, suggest_improvements, find_gaps, deduplicate, draft_skill.',
  role: 'librarian',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['analyze', 'suggest_improvements', 'find_gaps', 'deduplicate', 'draft_skill'],
        description: 'Curation action to perform',
      },
      skill: { type: 'string', description: 'Target skill name (for analyze, suggest_improvements)' },
      topic: { type: 'string', description: 'Topic for draft_skill or find_gaps' },
    },
    required: ['action'],
  },
};

export function handler(librarian) {
  return async (args) => {
    const { action, skill, topic } = args;
    return librarian.curate(action, { skill, topic });
  };
}
