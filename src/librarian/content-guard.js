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
  // ChatML / LLM control tokens (all known formats)
  /<\|im_start\|>/,
  /<\|im_end\|>/,
  /<\|system\|>/,
  /<\|user\|>/,
  /<\|assistant\|>/,
  /<\|endoftext\|>/,
  /<\|pad\|>/,
  // Llama / Mistral / Gemma control tokens
  /\[INST\]/,
  /\[\/INST\]/,
  /^<\/?s>$/m,  // Llama <s>/<\/s> on own line — not inline HTML strikethrough
  /<<SYS>>/,
  /<<\/SYS>>/,
  // Explicit instruction override attempts (broad pattern matching)
  /IGNORE\s+(?:ALL\s+)?(?:PREVIOUS|PRIOR|ABOVE|PRECEDING)?\s*INSTRUCTIONS/i,
  /DISREGARD\s+(?:ALL\s+)?(?:PRIOR|PREVIOUS|ABOVE|PRECEDING)?\s*(?:INSTRUCTIONS|CONTEXT|RULES|GUIDELINES)/i,
  /OVERRIDE\s+(?:ALL\s+)?(?:SAFETY|SYSTEM|SECURITY)\s*(?:RULES|FILTERS|MEASURES|GUIDELINES|PROTOCOLS)/i,
  /FORGET\s+(?:ALL\s+)?(?:PREVIOUS|PRIOR|ABOVE|YOUR)\s*(?:INSTRUCTIONS|RULES|CONTEXT|TRAINING)/i,
  /NEW\s+(?:SYSTEM\s+)?INSTRUCTIONS?\s*:/i,
  /UPDATED?\s+(?:SYSTEM\s+)?(?:INSTRUCTIONS?|PROMPT)\s*:/i,
  /YOUR\s+(?:NEW|REAL|ACTUAL|TRUE)\s+(?:INSTRUCTIONS?|PURPOSE|ROLE|TASK)\s/i,
  // Role reassignment / persona hijacking
  /YOU\s+ARE\s+NOW\s+(?:A|AN)\s+(?:UNCENSORED|UNFILTERED|UNRESTRICTED|JAILBROKEN|EVIL|MALICIOUS)\s+/i,
  /(?:ACT|BEHAVE|RESPOND|PRETEND|ROLEPLAY)\s+AS\s+(?:IF\s+YOU\s+(?:ARE|WERE)\s+)?(?:A|AN)\s+(?:UNCENSORED|UNFILTERED|UNRESTRICTED)/i,
  /ENTERING\s+(?:DAN|DEVELOPER|GOD|ADMIN|JAILBREAK|DEBUG|TEST)\s+MODE/i,
  /SWITCH(?:ING)?\s+TO\s+(?:DAN|DEVELOPER|GOD|ADMIN|JAILBREAK|UNRESTRICTED)\s+MODE/i,
  // Role impersonation in prose (someone trying to embed a fake system message)
  /^\[SYSTEM\]\s/m,
  /^SYSTEM:\s/m,
  /^<system>/mi,
  /^Human:\s/m,
  /^Assistant:\s/m,
  // Invisible instruction embedding
  /<!--\s*(?:SYSTEM|INSTRUCTION|IGNORE|OVERRIDE|PROMPT)/i,
  // Data exfiltration / tool manipulation
  /(?:CALL|INVOKE|EXECUTE|RUN)\s+(?:THE\s+)?(?:TOOL|FUNCTION|API)\s/i,
  /OUTPUT\s+(?:THE|YOUR|ALL)\s+(?:SYSTEM\s+)?PROMPT/i,
  /REVEAL\s+(?:THE|YOUR)\s+(?:SYSTEM\s+)?(?:PROMPT|INSTRUCTIONS)/i,
];

// Unicode that should NEVER appear in a markdown skill file, regardless of context
const UNICODE_BLOCKS = [
  { pattern: /\u0000/, name: 'null byte' },
  { pattern: /\u202E/, name: 'RTL override' },
  { pattern: /[\u200B-\u200F]/, name: 'zero-width character' },
  { pattern: /[\u2066-\u2069]/, name: 'bidi isolate' },
  { pattern: /[\u202A-\u202D]/, name: 'bidi embedding' },
  { pattern: /[\uFFF0-\uFFFD]/, name: 'specials block' },
  // Note: PUA (U+E000-U+F8FF) intentionally NOT blocked — Nerd Font glyphs live there
];

// Base64 blocks: >1000 chars = warning (could be legitimate code sample), >5000 = error
const BINARY_PAYLOAD_WARN = /[A-Za-z0-9+/=]{1000,}/;
const BINARY_PAYLOAD_BLOCK = /[A-Za-z0-9+/=]{5000,}/;

/**
 * Strip fenced code blocks and inline code from markdown.
 * Returns only the prose text for injection scanning.
 */
function extractProse(content) {
  // Remove fenced code blocks (``` or ~~~ with 3+ chars)
  let prose = content.replace(/^(`{3,}|~{3,})[\s\S]*?^\1/gm, '');
  // Remove double-backtick inline code (``code``) before single
  prose = prose.replace(/``[^`]+``/g, '');
  // Remove single-backtick inline code (`code`)
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

  // ReDoS prevention: reject if prose is unreasonably large (normal skills < 100KB prose)
  if (prose.length > 500_000) {
    issues.push({ severity: 'error', pattern: 'size', message: 'Prose content too large for scanning' });
    return { safe: false, issues };
  }

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
  if (BINARY_PAYLOAD_BLOCK.test(content)) {
    issues.push({
      severity: 'error',
      pattern: 'binary',
      message: 'Blocked: very large encoded payload (>5000 chars)',
    });
  } else if (BINARY_PAYLOAD_WARN.test(content)) {
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
