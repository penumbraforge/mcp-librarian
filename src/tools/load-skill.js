/**
 * load_skill — Full skill dump (legacy compat).
 */

export const definition = {
  name: 'load_skill',
  description: 'Load an entire skill file. Use find_skill for targeted retrieval instead — this returns the full file.',
  inputSchema: {
    type: 'object',
    properties: {
      skill: { type: 'string', description: 'Skill name (e.g., "redteam")' },
    },
    required: ['skill'],
  },
};

export function handler(store) {
  return (args) => {
    const { skill } = args;
    if (!skill) throw new Error('skill is required');

    const parsed = store.getSkill(skill);
    if (!parsed) {
      return { error: `Skill "${skill}" not found` };
    }

    return {
      name: parsed.name,
      description: parsed.frontmatter.description || '',
      content: parsed._raw,
    };
  };
}
