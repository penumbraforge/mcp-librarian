/**
 * Parse SKILL.md files into frontmatter + sections.
 * Format:
 *   ---
 *   name: ...
 *   description: ...
 *   ---
 *   ## Section Title
 *   content...
 */

export function parseSkill(content, skillName) {
  const result = { name: skillName, frontmatter: {}, sections: [] };

  // Extract YAML frontmatter
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
  if (fmMatch) {
    result.frontmatter = parseSimpleYaml(fmMatch[1]);
    content = content.slice(fmMatch[0].length);
  }

  // Split on ## headings
  const parts = content.split(/^(?=## )/m);

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    const headingMatch = trimmed.match(/^## (.+)/);
    if (headingMatch) {
      const heading = headingMatch[1].trim();
      const body = trimmed.slice(headingMatch[0].length).trim();
      result.sections.push({ heading, body, skill: skillName });
    } else {
      // Content before first ## heading (preamble)
      result.sections.push({ heading: '_preamble', body: trimmed, skill: skillName });
    }
  }

  return result;
}

// Keys that must never be set via YAML parsing (prototype pollution prevention)
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function parseSimpleYaml(text) {
  const result = Object.create(null); // No prototype chain
  for (const line of text.split('\n')) {
    const match = line.match(/^(\w[\w-]*)\s*:\s*(.+)/);
    if (match) {
      const key = match[1];
      if (FORBIDDEN_KEYS.has(key)) continue; // Block prototype pollution
      let val = match[2].trim();
      // Strip quotes
      if ((val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      result[key] = val;
    }
  }
  return result;
}

export function extractSectionHeadings(parsed) {
  return parsed.sections
    .filter(s => s.heading !== '_preamble')
    .map(s => s.heading);
}
