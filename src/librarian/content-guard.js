/**
 * Content poisoning prevention — context-aware.
 *
 * KEY DESIGN PRINCIPLE:
 * Skills legitimately contain code examples, security payloads, exploit patterns,
 * XSS payloads, SQL injection strings, etc. (especially the redteam skill).
 * These are REFERENCE MATERIAL, not attacks.
 *
 * What we actually block:
 * 1. STRUCTURAL INJECTION — attempts to hijack the AI reading the skill
 *    (prompt injection markers, role impersonation, instruction override)
 *    ONLY when they appear in prose, NOT inside code blocks.
 * 2. UNICODE TRICKS — always dangerous regardless of context (null bytes,
 *    RTL override, zero-width chars that could hide content).
 * 3. BINARY PAYLOADS — large encoded blobs that shouldn't be in a markdown skill.
 *
 * What we DO NOT block:
 * - <script>, <iframe>, SQL injection, XSS payloads inside code blocks
 * - Security tool commands (sqlmap, nmap, etc.)
 * - Words like "jailbreak", "exploit", "injection" — these are legitimate topics
 */

// Structural injection patterns — only checked in PROSE (outside code blocks)
const PROSE_INJECTION_PATTERNS = [
  // ChatML / LLM control tokens
  /<\|im_start\|>/,
  /<\|im_end\|>/,
  /<\|system\|>/,
  /<\|user\|>/,
  /<\|assistant\|>/,
  /<\|endoftext\|>/,
  // Explicit instruction override attempts
  /IGNORE\s+(?:ALL\s+)?PREVIOUS\s+INSTRUCTIONS/i,
  /DISREGARD\s+(?:ALL\s+)?(?:PRIOR|PREVIOUS|ABOVE)\s+(?:INSTRUCTIONS|CONTEXT|RULES)/i,
  /OVERRIDE\s+(?:ALL\s+)?(?:SAFETY|SYSTEM|SECURITY)\s+(?:RULES|FILTERS|MEASURES)/i,
  /YOU\s+ARE\s+NOW\s+(?:A|AN)\s+(?:UNCENSORED|UNFILTERED|UNRESTRICTED)\s+(?:AI|ASSISTANT|MODEL)/i,
  /ENTERING\s+(?:DAN|DEVELOPER|GOD|ADMIN)\s+MODE/i,
  // Role impersonation in prose (someone trying to embed a fake system message)
  /^\[SYSTEM\]\s/m,
  /^SYSTEM:\s/m,
  /^<system>\s/mi,
  // Invisible instruction embedding
  /<!--\s*(?:SYSTEM|INSTRUCTION|IGNORE|OVERRIDE)/i,
];

// Unicode that should NEVER appear in a markdown skill file, regardless of context
const UNICODE_BLOCKS = [
  { pattern: /\u0000/, name: 'null byte' },
  { pattern: /\u202E/, name: 'RTL override' },
  { pattern: /[\u200B-\u200F]/, name: 'zero-width character' },
  { pattern: /[\u2066-\u2069]/, name: 'bidi isolate' },
  { pattern: /[\u202A-\u202D]/, name: 'bidi embedding' },
  { pattern: /[\uFFF0-\uFFFD]/, name: 'specials block' },
  { pattern: /[\uE000-\uF8FF]/, name: 'private use area' },
];

// Suspiciously large base64 blocks (>1000 chars) — likely embedded binary
const BINARY_PAYLOAD = /[A-Za-z0-9+/=]{1000,}/;

/**
 * Strip fenced code blocks and inline code from markdown.
 * Returns only the prose text for injection scanning.
 */
function extractProse(content) {
  // Remove fenced code blocks (``` or ~~~)
  let prose = content.replace(/^(`{3,}|~{3,})[\s\S]*?^\1/gm, '');
  // Remove inline code (but not prose around it)
  prose = prose.replace(/`[^`\n]+`/g, '');
  return prose;
}

export function guardContent(content) {
  const issues = [];

  if (typeof content !== 'string') {
    return { safe: false, issues: [{ severity: 'error', pattern: 'type', message: 'Content must be a string' }] };
  }

  // 1. Unicode tricks — check FULL content (these are never legitimate)
  for (const { pattern, name } of UNICODE_BLOCKS) {
    if (pattern.test(content)) {
      issues.push({
        severity: 'error',
        pattern: 'unicode',
        message: `Blocked unicode: ${name}`,
      });
    }
  }

  // 2. Structural injection — check PROSE ONLY (outside code blocks)
  const prose = extractProse(content);
  for (const pattern of PROSE_INJECTION_PATTERNS) {
    if (pattern.test(prose)) {
      issues.push({
        severity: 'error',
        pattern: 'injection',
        message: `Structural injection in prose: ${pattern.source.slice(0, 50)}`,
      });
    }
  }

  // 3. Binary payloads — check full content
  if (BINARY_PAYLOAD.test(content)) {
    issues.push({
      severity: 'warning',
      pattern: 'binary',
      message: 'Large encoded payload detected (>1000 chars)',
    });
  }

  return {
    safe: issues.filter(i => i.severity === 'error').length === 0,
    issues,
  };
}

/**
 * Exported for testing.
 */
export { extractProse };
