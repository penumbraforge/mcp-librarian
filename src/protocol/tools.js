/**
 * MCP Tool Handlers for mcp-librarian v3.
 *
 * Exports:
 *  - getToolDefinitions()       — returns the array of MCP tool descriptors
 *  - handleToolCall(name, args, deps) — dispatches to the correct handler
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { McpError, ERROR_CODES } from '../errors.js';
import { checkContent } from '../security/content-guard.js';
import { PackFetcher } from './pack-fetcher.js';
import { checkDuplicate } from '../store/dedup.js';

// ---------------------------------------------------------------------------
// Tool Definitions
// ---------------------------------------------------------------------------

const TOOL_DEFINITIONS = [
  {
    name: 'find_skill',
    description: 'Search your knowledge library for patterns and best practices. Use this BEFORE implementing features involving security, APIs, databases, testing, Docker, TypeScript, git workflows, or any domain where established patterns exist. Returns ranked results with relevance scores.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural language search query (e.g. "SQL injection prevention", "git rebase workflow")' },
        limit: { type: 'number', description: 'Max results (default 10)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'find_and_load',
    description: 'Search the knowledge library and return the full content of the top matching skill in one call. Use this when you need actionable patterns for a task — combines search + load into a single step.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural language search query' },
      },
      required: ['query'],
    },
  },
  {
    name: 'load_section',
    description: 'Load a specific section from a skill by its slug path. Use when you only need one part of a skill (e.g. just the "error-handling" section).',
    inputSchema: {
      type: 'object',
      properties: {
        skill:   { type: 'string', description: 'Skill name' },
        section: { type: 'string', description: 'Section heading slug (e.g. "common-pitfalls", "image-hardening/use-minimal-base-images")' },
      },
      required: ['skill', 'section'],
    },
  },
  {
    name: 'load_skill',
    description: 'Load the full content of a skill by exact name. Use when you already know which skill you need.',
    inputSchema: {
      type: 'object',
      properties: {
        skill: { type: 'string', description: 'Skill name (e.g. "security-hardening", "api-design")' },
      },
      required: ['skill'],
    },
  },
  {
    name: 'list_skills',
    description: 'List all installed skills with their names, descriptions, categories, and available sections. Use this to see what knowledge is available in the library.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'skill_status',
    description: 'Get detailed integrity status for a single skill (hash, signature, signedAt).',
    inputSchema: {
      type: 'object',
      properties: {
        skill: { type: 'string', description: 'Skill name' },
      },
      required: ['skill'],
    },
  },
  {
    name: 'validate_skill',
    description: 'Validate skill content: checks frontmatter, section headings, and content guard (prompt injection scan).',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'Raw skill markdown content to validate' },
      },
      required: ['content'],
    },
  },
  {
    name: 'create_skill',
    description: 'Write a new skill to the skills directory after validating content. Used by AI agents to create skills from research.',
    inputSchema: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'Filename for the skill (e.g. "my-skill.md")' },
        content:  { type: 'string', description: 'Full skill markdown content including frontmatter' },
      },
      required: ['filename', 'content'],
    },
  },
  {
    name: 'install_pack',
    description: 'Install a skill pack from the community registry or a direct URL. Downloads, validates, and deduplicates skills.',
    inputSchema: {
      type: 'object',
      properties: {
        pack: { type: 'string', description: 'Pack identifier (e.g. "penumbraforge/web-dev-pack")' },
        url:  { type: 'string', description: 'Direct URL to a pack.json file (overrides pack identifier and default repo)' },
      },
      required: ['pack'],
    },
  },
  {
    name: 'export_pack',
    description: 'Export installed skills as a shareable pack. Exports all skills or a specified subset.',
    inputSchema: {
      type: 'object',
      properties: {
        name:        { type: 'string', description: 'Pack name' },
        description: { type: 'string', description: 'Pack description' },
        skills:      {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional list of skill names to export. Omit to export all.',
        },
      },
      required: ['name', 'description'],
    },
  },
  {
    name: 'server_status',
    description: 'Get server status: version, skill count, index stats, uptime, and config summary.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Return the array of MCP tool descriptors.
 * @returns {Array<{ name: string, description: string, inputSchema: object }>}
 */
export function getToolDefinitions() {
  return TOOL_DEFINITIONS;
}

/**
 * Dispatch a tool call to the correct handler.
 *
 * @param {string} name - Tool name
 * @param {object} args - Tool arguments (already parsed)
 * @param {{ store, config, logger, contentGuard, ed25519 }} deps
 * @returns {Promise<object>} Tool result
 */
export async function handleToolCall(name, args, deps) {
  const { store, config, logger } = deps;

  switch (name) {
    case 'find_skill':    return handleFindSkill(args, store);
    case 'find_and_load': return handleFindAndLoad(args, store);
    case 'load_section':  return handleLoadSection(args, store);
    case 'load_skill':    return handleLoadSkill(args, store);
    case 'list_skills':   return handleListSkills(store);
    case 'skill_status':  return handleSkillStatus(args, store);
    case 'validate_skill': return handleValidateSkill(args);
    case 'create_skill':  return handleCreateSkill(args, store);
    case 'install_pack':  return handleInstallPack(args, store, config, deps.packFetcher);
    case 'export_pack':   return handleExportPack(args, store, config);
    case 'server_status': return handleServerStatus(config, store);
    default:
      throw new McpError(
        ERROR_CODES.INVALID_INPUT,
        `Unknown tool: ${name}`,
        { name }
      );
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/**
 * find_skill — BM25 search
 */
function handleFindSkill(args, store) {
  const { query, limit = 10 } = args;

  if (!query || typeof query !== 'string' || query.trim() === '') {
    throw new McpError(
      ERROR_CODES.INVALID_INPUT,
      'find_skill requires a non-empty query string',
      { received: query }
    );
  }

  const results = store.search(query, limit);
  return { results };
}

/**
 * find_and_load — search and return the top skill's full content in one call
 */
async function handleFindAndLoad(args, store) {
  const { query } = args;

  if (!query || typeof query !== 'string' || query.trim() === '') {
    throw new McpError(
      ERROR_CODES.INVALID_INPUT,
      'find_and_load requires a non-empty query string',
      { received: query }
    );
  }

  const results = store.search(query, 5);

  if (results.length === 0) {
    return { found: false, query, message: 'No matching skills found.' };
  }

  // Load the top-scoring skill's full content
  const topSkill = results[0].skill;
  const content = await store.getSkill(topSkill);
  const sections = store.getSectionSlugs(topSkill);

  // Include other matches as suggestions
  const otherMatches = [...new Set(results.map(r => r.skill))]
    .filter(s => s !== topSkill)
    .slice(0, 3);

  return {
    found: true,
    skill: topSkill,
    content,
    sections,
    otherMatches: otherMatches.length > 0 ? otherMatches : undefined,
  };
}

/**
 * load_section — return a named section from a skill
 */
function handleLoadSection(args, store) {
  const { skill, section } = args;
  const content = store.getSection(skill, section);

  if (content === null || content === undefined) {
    throw new McpError(
      ERROR_CODES.SKILL_NOT_FOUND,
      `Skill "${skill}" not found or section "${section}" does not exist`,
      { skill, section }
    );
  }

  return { content };
}

/**
 * load_skill — return full skill content
 */
async function handleLoadSkill(args, store) {
  const { skill } = args;
  const content = await store.getSkill(skill);

  if (content === null || content === undefined) {
    throw new McpError(
      ERROR_CODES.SKILL_NOT_FOUND,
      `Skill "${skill}" not found`,
      { skill }
    );
  }

  // Include section slugs so the caller knows valid load_section paths
  const sections = store.getSectionSlugs(skill);

  return { content, sections };
}

/**
 * list_skills — return all skill metadata
 */
function handleListSkills(store) {
  const skills = store.listSkills();
  return { skills };
}

/**
 * skill_status — return integrity status for a skill
 */
function handleSkillStatus(args, store) {
  const { skill } = args;
  const status = store.skillStatus(skill);

  if (status === null || status === undefined) {
    throw new McpError(
      ERROR_CODES.SKILL_NOT_FOUND,
      `Skill "${skill}" not found`,
      { skill }
    );
  }

  return status;
}

// ---------------------------------------------------------------------------
// Frontmatter validation helpers
// ---------------------------------------------------------------------------

const REQUIRED_FRONTMATTER_FIELDS = ['name', 'version', 'category', 'description'];

/**
 * Parse and validate skill content.
 * Returns an array of issue objects ({ type, message }).
 * Empty array means valid.
 *
 * @param {string} content
 * @returns {Array<{ type: string, message: string }>}
 */
function validateSkillContent(content) {
  const issues = [];

  // --- 1. Check frontmatter presence ---
  const parts = content.split('---');
  // Valid YAML frontmatter: content starts with ---, so parts[0] should be empty (or just whitespace)
  // parts[1] is the frontmatter block, parts[2+] is the body
  const hasFrontmatter = parts.length >= 3 && parts[0].trim() === '';

  if (!hasFrontmatter) {
    issues.push({
      type: 'missing-frontmatter',
      message: 'Skill must begin with YAML frontmatter delimited by ---',
    });
    // Without frontmatter we can't check required fields; check remaining things
  } else {
    // --- 2. Check required frontmatter fields ---
    const frontmatterBlock = parts[1];
    const presentFields = new Set();

    for (const line of frontmatterBlock.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx === -1) continue;
      const key = trimmed.slice(0, colonIdx).trim();
      if (key) presentFields.add(key);
    }

    for (const field of REQUIRED_FRONTMATTER_FIELDS) {
      if (!presentFields.has(field)) {
        issues.push({
          type: 'missing-frontmatter-field',
          message: `Frontmatter is missing required field: "${field}"`,
        });
      }
    }
  }

  // --- 3. Check for at least one ## section heading ---
  const hasSection = /^##\s+\S/m.test(content);
  if (!hasSection) {
    issues.push({
      type: 'missing-section-heading',
      message: 'Skill must contain at least one ## section heading',
    });
  }

  // --- 4. Content guard (prompt injection scan) ---
  const guardResult = checkContent(content);
  if (!guardResult.safe) {
    for (const violation of guardResult.violations) {
      issues.push({
        type: `content-guard:${violation.category}`,
        message: `Content guard violation (${violation.category}): ${violation.snippet}`,
      });
    }
  }

  return issues;
}

/**
 * validate_skill — validate content without writing
 */
function handleValidateSkill(args) {
  const { content } = args;
  const issues = validateSkillContent(content);

  if (issues.length === 0) {
    return { valid: true };
  }

  return { valid: false, issues };
}

/**
 * create_skill — validate then write to store
 */
async function handleCreateSkill(args, store) {
  const { filename, content } = args;

  // Validate first
  const issues = validateSkillContent(content);
  if (issues.length > 0) {
    return { created: false, issues };
  }

  // Extract skill name from frontmatter for the response
  const parts = content.split('---');
  let skillName = filename.replace(/\.md$/, '');
  if (parts.length >= 3) {
    for (const line of parts[1].split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('name:')) {
        skillName = trimmed.slice('name:'.length).trim();
        break;
      }
    }
  }

  // Write the skill
  await store.addSkill(filename, content);

  // Rebuild index (includes re-signing if configured)
  await store.rebuild();

  return { created: true, skill: skillName };
}

/**
 * install_pack — fetch a skill pack from GitHub and install validated skills.
 *
 * Atomic: all files are fetched and validated before anything is written.
 * If any network fetch fails, nothing is written to disk.
 *
 * @param {object} args
 * @param {object} store
 * @param {object} config
 * @param {PackFetcher|null} [injectedFetcher]  - Optional override for testing
 */
async function handleInstallPack(args, store, config, injectedFetcher = null) {
  const { pack: packName, url: directUrl } = args;

  if (!packName || typeof packName !== 'string' || packName.trim() === '') {
    throw new McpError(
      ERROR_CODES.INVALID_INPUT,
      'install_pack requires a non-empty pack name',
      { received: packName }
    );
  }

  // Use injected fetcher (for tests) or create one from config
  const fetcher = injectedFetcher ?? new PackFetcher(config);

  // ---- Phase 1: Fetch pack.json (from direct URL or default repo) ----
  const packJson = await fetcher.fetchPackJson(packName, directUrl);

  const skillFiles = packJson.skills;
  if (!Array.isArray(skillFiles) || skillFiles.length === 0) {
    return {
      installed: 0,
      updated: 0,
      skipped: 0,
      rejected: 0,
      details: { installed: [], updated: [], skipped: [], rejected: [] },
    };
  }

  // ---- Phase 2: Fetch ALL skill files before touching disk ----
  // Build Map<filename → content> in memory. Fail fast on any network error.
  const fetched = new Map(); // filename → raw content string

  for (const filename of skillFiles) {
    // May throw McpError (PACK_NOT_FOUND or PACK_FETCH_FAILED) — propagates upward
    const content = await fetcher.fetchSkillFile(packName, filename);
    fetched.set(filename, content);
  }

  // ---- Phase 3: Validate all fetched files ----
  // Build the existing-skills map for dedup.
  // checkDuplicate() expects Map<filename → { name, hash }>.
  // listSkills() doesn't include hash; skillStatus() does — use it.
  const existingSkillsList = store.listSkills();
  const existingSkillsMap = new Map();
  for (const s of existingSkillsList) {
    const statusEntry = store.skillStatus(s.name);
    const filename = s.filename ?? `${s.name}.md`;
    existingSkillsMap.set(filename, {
      name: s.name,
      hash: statusEntry?.hash ?? null,
    });
  }

  const toInstall  = []; // { filename, content }
  const toUpdate   = []; // { filename, content, replaces }
  const skipped    = []; // filename strings
  const rejected   = []; // { filename, reason }

  for (const [filename, content] of fetched) {
    // Content guard check
    const guardResult = checkContent(content);
    if (!guardResult.safe) {
      const reasons = guardResult.violations.map(v => `${v.category}: ${v.snippet}`);
      rejected.push({ filename, reason: reasons.join('; ') });
      continue;
    }

    // Extract skill name from frontmatter (fallback to filename stem)
    let skillName = filename.replace(/\.md$/, '');
    const parts = content.split('---');
    if (parts.length >= 3) {
      for (const line of parts[1].split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('name:')) {
          skillName = trimmed.slice('name:'.length).trim();
          break;
        }
      }
    }

    // Dedup check
    const dedupResult = checkDuplicate(content, skillName, existingSkillsMap);

    if (dedupResult.action === 'skip') {
      skipped.push(filename);
    } else if (dedupResult.action === 'update') {
      toUpdate.push({ filename, content, replaces: dedupResult.replaces });
    } else {
      // 'install'
      toInstall.push({ filename, content });
    }
  }

  // ---- Phase 4: Atomic write ----
  // Remove old files for updates, write new/updated files
  for (const { replaces } of toUpdate) {
    await store.removeSkill(replaces);
  }
  for (const { filename, content } of [...toInstall, ...toUpdate]) {
    await store.addSkill(filename, content);
  }

  // ---- Phase 5: Re-sign manifest + rebuild index ----
  if (toInstall.length > 0 || toUpdate.length > 0) {
    await store.rebuild();
  }

  return {
    installed: toInstall.length,
    updated:   toUpdate.length,
    skipped:   skipped.length,
    rejected:  rejected.length,
    details: {
      installed: toInstall.map(f => f.filename),
      updated:   toUpdate.map(f => f.filename),
      skipped,
      rejected,
    },
  };
}

/**
 * export_pack — export skills as a distributable pack
 */
async function handleExportPack(args, store, config) {
  const { name, description, skills: skillFilter } = args;

  // Get the list of all skills
  const allSkills = store.listSkills();

  // Filter if a specific list was provided
  const skillsToExport = skillFilter
    ? allSkills.filter(s => skillFilter.includes(s.name))
    : allSkills;

  // Load content for each skill
  const filenames = [];
  const skillContents = [];

  for (const skillMeta of skillsToExport) {
    const content = await store.getSkill(skillMeta.name);
    if (content !== null && content !== undefined) {
      const filename = `${skillMeta.name}.md`;
      filenames.push(filename);
      skillContents.push({ filename, content });
    }
  }

  // Write pack files to disk
  const exportDir = join(config.home, 'exports', name);
  await mkdir(exportDir, { recursive: true });

  const packJson = { name, version: '1.0.0', description, skills: filenames };
  await writeFile(join(exportDir, 'pack.json'), JSON.stringify(packJson, null, 2) + '\n', 'utf8');

  for (const { filename, content } of skillContents) {
    await writeFile(join(exportDir, filename), content, 'utf8');
  }

  return {
    exported: filenames.length,
    path: exportDir,
    pack: packJson,
  };
}

/**
 * server_status — return server health info
 */
function handleServerStatus(config, store) {
  const { skillCount, chunkCount, uniqueTerms } = store.stats();

  return {
    version: '3.0.0',
    skillCount,
    indexStats: { chunkCount, uniqueTerms },
    uptime: process.uptime(),
    config: {
      logLevel:   config.logLevel,
      rateLimit:  config.rateLimit,
      cacheSize:  config.cacheSize,
      skillsRepo: config.skillsRepo,
    },
  };
}
