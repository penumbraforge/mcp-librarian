/**
 * librarian_promote — Promote staging → live (librarian role only).
 */

export const definition = {
  name: 'librarian_promote',
  description: 'Promote a staged skill to live. Shows diff and runs content guard before applying. Librarian role only.',
  role: 'librarian',
  inputSchema: {
    type: 'object',
    properties: {
      skill: { type: 'string', description: 'Skill name in staging to promote' },
      confirm: { type: 'boolean', description: 'Set to true to confirm promotion after reviewing diff' },
    },
    required: ['skill'],
  },
};

export function handler(librarian) {
  return async (args) => {
    const { skill, confirm } = args;
    if (!skill) throw new Error('skill is required');

    if (!confirm) {
      // Preview mode — show diff
      return librarian.previewPromotion(skill);
    }

    return librarian.promote(skill);
  };
}
