/**
 * load_section — Load a specific section by skill name + heading.
 * Supports exact match (case-insensitive) and fuzzy substring match.
 */

export const definition = {
  name: 'load_section',
  description: 'Load a specific section from a skill by name and heading. Supports fuzzy heading matching (e.g., "BullMQ" matches "BullMQ > Queue Setup"). Returns the section with its domain label for context.',
  inputSchema: {
    type: 'object',
    properties: {
      skill: { type: 'string', description: 'Skill name (e.g., "automation", "redteam")' },
      heading: { type: 'string', description: 'Section heading or partial match (e.g., "BullMQ", "SQL Injection")' },
    },
    required: ['skill', 'heading'],
  },
};

export function handler(store) {
  return (args) => {
    const { skill, heading } = args;
    if (!skill || !heading) throw new Error('skill and heading are required');

    const parsed = store.getSkill(skill);
    if (!parsed) {
      return `Skill "${skill}" not found. Use list_skills to see available skills.`;
    }

    // Try exact match first (case-insensitive)
    let section = parsed.sections.find(
      s => s.heading.toLowerCase() === heading.toLowerCase()
    );

    // Fuzzy: try substring match
    if (!section) {
      const lower = heading.toLowerCase();
      section = parsed.sections.find(
        s => s.heading.toLowerCase().includes(lower) || lower.includes(s.heading.toLowerCase())
      );
    }

    if (!section) {
      const available = parsed.sections
        .filter(s => s.heading !== '_preamble')
        .map(s => s.heading);
      return `Section "${heading}" not found in skill "${skill}".\n\nAvailable sections:\n${available.map(h => `- ${h}`).join('\n')}`;
    }

    const domain = parsed.frontmatter?.domain || 'general';

    return [
      `## [${domain}] ${skill} → ${section.heading}`,
      `_Domain: ${domain} | Skill: ${skill}_\n`,
      section.body,
    ].join('\n');
  };
}
