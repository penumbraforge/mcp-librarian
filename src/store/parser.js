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

function parseSimpleYaml(text) {
  const result = {};
  for (const line of text.split('\n')) {
    const match = line.match(/^(\w[\w-]*)\s*:\s*(.+)/);
    if (match) {
      let val = match[2].trim();
      // Strip quotes
      if ((val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      result[match[1]] = val;
    }
  }
  return result;
}

export function extractSectionHeadings(parsed) {
  return parsed.sections
    .filter(s => s.heading !== '_preamble')
    .map(s => s.heading);
}
