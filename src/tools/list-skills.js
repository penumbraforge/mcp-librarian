/**
 * list_skills — Compact catalog with domain labels and section headings.
 */

export const definition = {
  name: 'list_skills',
  description: 'List all available skills with domain labels, descriptions, and section headings. Compact overview for discovering what knowledge is available.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
};

export function handler(store) {
  return () => {
    const skills = store.listSkills();
    if (skills.length === 0) return 'No skills loaded.';

    const lines = [`## Skill Library (${skills.length} skills)\n`];

    for (const s of skills) {
      const domain = s.domain || 'general';
      const disabledTag = s.enabled === false ? ' [disabled]' : '';
      const qualityTag = s.quality != null ? ` (q:${Math.round(s.quality * 100) / 100})` : '';
      lines.push(`- **[${domain}] ${s.name}**${disabledTag}${qualityTag}: ${s.description}`);
      if (s.sections.length > 0) {
        lines.push(`  Sections: ${s.sections.join(', ')}`);
      }
    }

    return lines.join('\n');
  };
}
