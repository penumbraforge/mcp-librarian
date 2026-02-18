/**
 * Content poisoning prevention.
 * Validates ALL content before entering the skill store.
 */

const BLOCK_PATTERNS = [
  // Dynamic code execution with untrusted input
  /eval\s*\(\s*[^)]*\b(input|req|param|arg|user|data)\b/i,
  // HTML injection
  /<script[\s>]/i,
  /<iframe[\s>]/i,
  /<object[\s>]/i,
  // Prompt injection markers
  /\[SYSTEM\]/,
  /<\|im_start\|>/,
  /<\|im_end\|>/,
  /IGNORE\s+(?:ALL\s+)?PREVIOUS\s+INSTRUCTIONS/i,
  /YOU\s+ARE\s+NOW\s+(?:A|AN)\s+(?:UNCENSORED|UNFILTERED|UNRESTRICTED)/i,
  /DISREGARD\s+(?:ALL\s+)?(?:PRIOR|PREVIOUS|ABOVE)/i,
  /jailbreak/i,
  /DAN\s+mode/i,
];

const UNICODE_BLOCKS = [
  /\u0000/,                    // Null bytes
  /\u202E/,                    // RTL override
  /[\u200B-\u200F]/,           // Zero-width chars
  /[\uFFF0-\uFFFF]/,           // Specials block
];

// Suspiciously large base64 blocks (>500 chars of pure base64)
const BASE64_PATTERN = /[A-Za-z0-9+/=]{500,}/;

export function guardContent(content) {
  const issues = [];

  if (typeof content !== 'string') {
    return { safe: false, issues: [{ severity: 'error', pattern: 'type', message: 'Content must be a string' }] };
  }

  // Check block patterns
  for (const pattern of BLOCK_PATTERNS) {
    if (pattern.test(content)) {
      issues.push({
        severity: 'error',
        pattern: pattern.source.slice(0, 40),
        message: `Blocked pattern detected: ${pattern.source.slice(0, 40)}`,
      });
    }
  }

  // Check unicode tricks
  for (const pattern of UNICODE_BLOCKS) {
    if (pattern.test(content)) {
      issues.push({
        severity: 'error',
        pattern: 'unicode',
        message: `Blocked unicode character detected`,
      });
    }
  }

  // Check for large base64 payloads
  if (BASE64_PATTERN.test(content)) {
    issues.push({
      severity: 'warning',
      pattern: 'base64',
      message: 'Suspiciously large base64 block detected',
    });
  }

  return {
    safe: issues.filter(i => i.severity === 'error').length === 0,
    issues,
  };
}
