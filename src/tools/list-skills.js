/**
 * list_skills — Compact catalog with section headings.
 */

export const definition = {
  name: 'list_skills',
  description: 'List all available skills with their descriptions and section headings. Compact overview (~100 tokens).',
  inputSchema: {
    type: 'object',
    properties: {},
  },
};

export function handler(store) {
  return () => {
    const skills = store.listSkills();
    return {
      count: skills.length,
      skills: skills.map(s => ({
        name: s.name,
        description: s.description,
        sections: s.sections,
        status: s.status,
      })),
    };
  };
}
