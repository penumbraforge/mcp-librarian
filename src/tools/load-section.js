/**
 * load_section — Load a specific section by skill name + heading.
 */

export const definition = {
  name: 'load_section',
  description: 'Load a specific section from a skill by name and heading. Use after find_skill to get full section content.',
  inputSchema: {
    type: 'object',
    properties: {
      skill: { type: 'string', description: 'Skill name (e.g., "automation")' },
      heading: { type: 'string', description: 'Section heading (e.g., "BullMQ Patterns")' },
    },
    required: ['skill', 'heading'],
  },
};

export function handler(store) {
  return (args) => {
    const { skill, heading } = args;
    if (!skill || !heading) throw new Error('skill and heading are required');

    const section = store.getSection(skill, heading);
    if (!section) {
      return { error: `Section "${heading}" not found in skill "${skill}"` };
    }

    return {
      skill: section.skill,
      heading: section.heading,
      content: section.body,
    };
  };
}
