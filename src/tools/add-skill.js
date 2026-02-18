/**
 * add_skill — Create a new skill from the standard template, or stage raw content.
 * Librarian role only.
 */

import { SKILL_TEMPLATE, VALID_DOMAINS } from '../librarian/validator.js';

export const definition = {
  name: 'add_skill',
  description: `Create a new skill from the standard template or stage raw SKILL.md content. Librarian role only. Creates in staging — use librarian_promote to make it live. Valid domains: ${VALID_DOMAINS.join(', ')}`,
  role: 'librarian',
  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Skill name (lowercase, alphanumeric + hyphens, e.g., "kubernetes")',
      },
      description: {
        type: 'string',
        description: 'Short description (max 200 chars)',
      },
      domain: {
        type: 'string',
        enum: VALID_DOMAINS,
        description: 'Skill domain category',
      },
      content: {
        type: 'string',
        description: 'Full SKILL.md content. If omitted, generates from template.',
      },
    },
    required: ['name', 'description', 'domain'],
  },
};

export function handler(staging) {
  return (args) => {
    const { name, description, domain, content } = args;

    if (!name || !/^[a-z0-9_-]+$/.test(name)) {
      throw new Error('name must be lowercase alphanumeric with hyphens/underscores');
    }
    if (!description || description.length > 200) {
      throw new Error('description is required (max 200 chars)');
    }
    if (!VALID_DOMAINS.includes(domain)) {
      throw new Error(`Invalid domain. Valid: ${VALID_DOMAINS.join(', ')}`);
    }

    const skillContent = content || SKILL_TEMPLATE
      .replace('{{NAME}}', name)
      .replace('{{DESCRIPTION}}', description)
      .replace('{{DOMAIN}}', domain);

    const result = staging.stage(name, skillContent);

    return {
      skill: name,
      domain,
      ...result,
      next: result.staged
        ? 'Skill staged. Use librarian_promote to review and make it live.'
        : 'Staging failed — fix the issues and try again.',
    };
  };
}
