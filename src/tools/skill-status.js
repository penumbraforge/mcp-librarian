/**
 * skill_status — Integrity and staleness status from manifest.
 */

export const definition = {
  name: 'skill_status',
  description: 'Check integrity and staleness status of skills. Shows VERIFIED, TAMPERED, UNSIGNED, or STALE.',
  inputSchema: {
    type: 'object',
    properties: {
      skill: { type: 'string', description: 'Specific skill name, or omit for all skills' },
    },
  },
};

export function handler(store) {
  return (args) => {
    const { skill } = args;

    if (skill) {
      const status = store.verifySkill(skill);
      const entry = store.manifest?.skills?.[skill];
      return {
        skill,
        ...status,
        signedAt: entry?.signedAt || null,
      };
    }

    // All skills
    const results = [];
    for (const [name] of store.skills) {
      const status = store.verifySkill(name);
      const entry = store.manifest?.skills?.[name];
      results.push({
        skill: name,
        ...status,
        signedAt: entry?.signedAt || null,
      });
    }
    return { skills: results };
  };
}
