/**
 * load_skill — Full skill dump with domain header.
 */

export const definition = {
  name: 'load_skill',
  description: 'Load an entire skill file. Prefer find_skill for targeted retrieval — this returns the full file which may be 500-1500 tokens.',
  inputSchema: {
    type: 'object',
    properties: {
      skill: { type: 'string', description: 'Skill name (e.g., "redteam", "frontend")' },
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
      return `Skill "${skill}" not found.`;
    }

    const domain = parsed.frontmatter.domain || 'general';

    return [
      `## [${domain}] Full skill: ${parsed.name}`,
      `_Domain: ${domain} | ${parsed.frontmatter.description || ''}_\n`,
      parsed._raw,
    ].join('\n');
  };
}
