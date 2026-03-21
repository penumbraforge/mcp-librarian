/**
 * MCP Resources — exposes installed skills as skill:// URIs.
 *
 * URI scheme:
 *   skill://{name}           → full skill content
 *   skill://{name}/{section} → single section content
 */

import { McpError, ERROR_CODES } from '../errors.js';

const MIME_TYPE = 'text/markdown';

/**
 * Return MCP resource descriptors for all installed skills.
 *
 * @param {object} store  SkillStore (or compatible mock)
 * @returns {Array<{ uri: string, name: string, description: string, mimeType: string }>}
 */
export function listResources(store) {
  return store.listSkills().map(skill => ({
    uri: `skill://${skill.name}`,
    name: skill.name,
    description: skill.description,
    mimeType: MIME_TYPE,
  }));
}

/**
 * Read a resource by URI and return its content.
 *
 * @param {string} uri     e.g. 'skill://kubernetes' or 'skill://kubernetes/security'
 * @param {object} store   SkillStore (or compatible mock)
 * @returns {Promise<{ contents: Array<{ uri: string, mimeType: string, text: string }> }>}
 */
export async function readResource(uri, store) {
  // Parse skill:// URI
  // Format: skill://name  or  skill://name/section-slug
  const prefix = 'skill://';
  if (!uri.startsWith(prefix)) {
    throw new McpError(ERROR_CODES.INVALID_INPUT, `Unsupported URI scheme: ${uri}`, { uri });
  }

  const rest = uri.slice(prefix.length);
  // rest = "name" or "name/section-slug"
  const slashIdx = rest.indexOf('/');

  let skillName;
  let sectionSlug;

  if (slashIdx === -1) {
    skillName = rest;
    sectionSlug = null;
  } else {
    skillName = rest.slice(0, slashIdx);
    sectionSlug = rest.slice(slashIdx + 1);
  }

  if (!skillName) {
    throw new McpError(ERROR_CODES.INVALID_INPUT, `Invalid resource URI: ${uri}`, { uri });
  }

  let text;

  if (sectionSlug === null) {
    // Full skill content
    text = await store.getSkill(skillName);
    if (text === null || text === undefined) {
      throw new McpError(
        ERROR_CODES.SKILL_NOT_FOUND,
        `Skill not found: ${skillName}`,
        { name: skillName }
      );
    }
  } else {
    // Section content — getSection is synchronous but may return null for missing skill
    // First verify the skill exists to give an accurate error
    const skillExists = await store.getSkill(skillName);
    if (skillExists === null || skillExists === undefined) {
      throw new McpError(
        ERROR_CODES.SKILL_NOT_FOUND,
        `Skill not found: ${skillName}`,
        { name: skillName }
      );
    }

    text = store.getSection(skillName, sectionSlug);
    if (text === null || text === undefined) {
      throw new McpError(
        ERROR_CODES.SKILL_NOT_FOUND,
        `Section not found: ${sectionSlug} in skill ${skillName}`,
        { name: skillName, section: sectionSlug }
      );
    }
  }

  return {
    contents: [
      {
        uri,
        mimeType: MIME_TYPE,
        text,
      },
    ],
  };
}
