/**
 * Validate SKILL.md structure against the standard schema.
 *
 * Required frontmatter:
 *   name: string (alphanumeric + hyphens)
 *   description: string (1-200 chars)
 *
 * Optional frontmatter:
 *   domain: string (e.g., "security", "frontend", "scripting", "automation", "general")
 *   version: string (semver-like)
 *   author: string
 *   tags: comma-separated string
 *
 * Structure:
 *   - Must have at least one ## section heading
 *   - Sections: 1-50
 *   - Total size: 100 bytes - 100 KB
 */

const REQUIRED_FIELDS = ['name', 'description'];
const VALID_DOMAINS = ['security', 'frontend', 'scripting', 'automation', 'devops', 'general'];
const MIN_SIZE_BYTES = 100;
const MAX_SIZE_BYTES = 100 * 1024;
const MAX_SECTIONS = 50;

export function validateSkill(parsed) {
  const issues = [];

  // Check required frontmatter
  for (const key of REQUIRED_FIELDS) {
    if (!parsed.frontmatter?.[key]) {
      issues.push({ severity: 'error', message: `Missing required frontmatter: ${key}` });
    }
  }

  // Validate name format
  if (parsed.frontmatter?.name && !/^[a-z0-9_-]+$/i.test(parsed.frontmatter.name)) {
    issues.push({ severity: 'error', message: 'Frontmatter name must be alphanumeric with hyphens/underscores' });
  }

  // Validate description length
  if (parsed.frontmatter?.description) {
    const desc = parsed.frontmatter.description;
    if (desc.length > 200) {
      issues.push({ severity: 'warning', message: `Description too long: ${desc.length} chars (max 200)` });
    }
  }

  // Validate domain if present
  if (parsed.frontmatter?.domain && !VALID_DOMAINS.includes(parsed.frontmatter.domain)) {
    issues.push({ severity: 'warning', message: `Unknown domain "${parsed.frontmatter.domain}". Valid: ${VALID_DOMAINS.join(', ')}` });
  }

  // Check sections
  const sections = parsed.sections.filter(s => s.heading !== '_preamble');
  if (sections.length === 0) {
    issues.push({ severity: 'error', message: 'Must have at least one ## section heading' });
  }
  if (sections.length > MAX_SECTIONS) {
    issues.push({ severity: 'error', message: `Too many sections: ${sections.length} (max ${MAX_SECTIONS})` });
  }

  // Check size
  if (parsed._raw) {
    const size = Buffer.byteLength(parsed._raw, 'utf8');
    if (size < MIN_SIZE_BYTES) {
      issues.push({ severity: 'warning', message: `Content too small: ${size} bytes (min ${MIN_SIZE_BYTES})` });
    }
    if (size > MAX_SIZE_BYTES) {
      issues.push({ severity: 'error', message: `Content too large: ${size} bytes (max ${MAX_SIZE_BYTES})` });
    }
  }

  return {
    valid: issues.filter(i => i.severity === 'error').length === 0,
    issues,
  };
}

export const SKILL_TEMPLATE = `---
name: {{NAME}}
description: "{{DESCRIPTION}}"
domain: {{DOMAIN}}
version: "1.0"
---

## Overview

Brief overview of this skill's purpose and when to use it.

## Core Patterns

Key patterns, commands, or techniques.

## Examples

Practical examples with code blocks.

## Common Pitfalls

What to avoid and how to troubleshoot.
`;

export { VALID_DOMAINS };
