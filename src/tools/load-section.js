/**
 * load_section — Load a specific section by skill name + heading.
 */

export const definition = {
  name: 'load_section',
  description: 'Load a specific section from a skill by name and heading. Returns the section with its domain label for context.',
  inputSchema: {
    type: 'object',
    properties: {
      skill: { type: 'string', description: 'Skill name (e.g., "automation", "redteam")' },
      heading: { type: 'string', description: 'Section heading (e.g., "BullMQ Patterns", "SQL Injection")' },
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
      return `Section "${heading}" not found in skill "${skill}".`;
    }

    const parsed = store.skills.get(skill);
    const domain = parsed?.frontmatter?.domain || 'general';

    return [
      `## [${domain}] ${skill} → ${heading}`,
      `_Domain: ${domain} | Skill: ${skill}_\n`,
      section.body,
    ].join('\n');
  };
}
