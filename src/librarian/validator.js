/**
 * Validate SKILL.md structure: YAML frontmatter + sections.
 */

const REQUIRED_FRONTMATTER = ['name', 'description'];
const MIN_SECTION_BYTES = 100;
const MAX_SECTION_BYTES = 100 * 1024; // 100 KB
const MAX_SECTIONS = 50;

export function validateSkill(parsed) {
  const issues = [];

  // Check frontmatter
  for (const key of REQUIRED_FRONTMATTER) {
    if (!parsed.frontmatter?.[key]) {
      issues.push({ severity: 'error', message: `Missing frontmatter field: ${key}` });
    }
  }

  // Check sections
  const sections = parsed.sections.filter(s => s.heading !== '_preamble');
  if (sections.length === 0) {
    issues.push({ severity: 'error', message: 'Must have at least one ## section heading' });
  }

  if (sections.length > MAX_SECTIONS) {
    issues.push({ severity: 'error', message: `Too many sections: ${sections.length} (max ${MAX_SECTIONS})` });
  }

  // Check raw content size
  if (parsed._raw) {
    const size = Buffer.byteLength(parsed._raw, 'utf8');
    if (size < MIN_SECTION_BYTES) {
      issues.push({ severity: 'warning', message: `Content too small: ${size} bytes (min ${MIN_SECTION_BYTES})` });
    }
    if (size > MAX_SECTION_BYTES) {
      issues.push({ severity: 'error', message: `Content too large: ${size} bytes (max ${MAX_SECTION_BYTES})` });
    }
  }

  return {
    valid: issues.filter(i => i.severity === 'error').length === 0,
    issues,
  };
}
