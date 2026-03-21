/**
 * Content Guard — prompt injection scanner for skill content.
 *
 * Scans prose regions only; code blocks (fenced or 4-space indented) are exempt.
 *
 * @module content-guard
 */

// ---------------------------------------------------------------------------
// Pattern definitions
// ---------------------------------------------------------------------------

/**
 * Each entry: { category, pattern } where pattern is a RegExp.
 * All patterns are applied to prose regions only.
 */
const PATTERNS = [
  // ChatML special tokens
  {
    category: 'chatml',
    pattern:  /<\|(?:im_start|im_end|system|end|user|assistant)\|>/i,
  },

  // Llama / Mistral tokens
  {
    category: 'llama',
    pattern:  /\[INST\]|<<SYS>>|\[\/INST\]/i,
  },

  // Instruction override phrases (case-insensitive)
  {
    category: 'instruction-override',
    pattern:  /IGNORE.{0,30}INSTRUCTIONS|DISREGARD.{0,30}ABOVE|FORGET.{0,30}PREVIOUS/i,
  },

  // Role impersonation
  {
    category: 'role-impersonation',
    pattern:  /YOU\s+ARE\s+NOW\b|ACT\s+AS\b|PRETEND\s+TO\s+BE\b/i,
  },

  // Data exfiltration
  {
    category: 'exfiltration',
    pattern:  /REVEAL.{0,20}PROMPT|SHOW.{0,20}SYSTEM|OUTPUT.{0,20}INSTRUCTIONS/i,
  },

  // XML tag injection
  {
    category: 'xml-injection',
    pattern:  /<\/?(?:operations|instructions|system|override|procedure)\b/i,
  },

  // Unicode tricks: null byte, RTL override, zero-width chars, variation selectors, soft hyphen
  {
    category: 'unicode-trick',
    pattern:  /[\x00\u202E\u200B\u200C\u200D\uFEFF\uFE0E\uFE0F\u00AD]/,
  },

  // Large base64 payload (>5000 consecutive base64 characters outside code)
  {
    category: 'base64-payload',
    pattern:  /[A-Za-z0-9+/]{5001,}={0,2}/,
  },
];

// ---------------------------------------------------------------------------
// Region parser
// ---------------------------------------------------------------------------

/**
 * Split content into alternating regions: prose and code.
 * Returns an array of { type: 'prose'|'code', text: string } objects.
 *
 * Code regions:
 *   1. Fenced blocks: ``` ... ``` (with optional language tag)
 *   2. 4-space (or tab) indented lines — only when preceded by a blank line
 *      or at the start of the file (CommonMark-style).
 *
 * @param {string} content
 * @returns {Array<{ type: string, text: string }>}
 */
function parseRegions(content) {
  const regions = [];
  let remaining = content;

  // Regex for fenced code block: opening ``` (with optional lang) to closing ```
  // We handle this line-by-line style via split on the fence pattern.
  // Strategy: scan for the earliest code block start marker each iteration.

  while (remaining.length > 0) {
    // Find next fenced block
    const fenceStart = remaining.search(/^`{3,}[^\n]*$/m);

    // Find next indented code block:
    // An indented block starts after a blank line (or at position 0) when
    // lines are consistently indented by 4+ spaces or 1 tab.
    const indentBlockStart = findIndentedBlockStart(remaining);

    if (fenceStart === -1 && indentBlockStart === -1) {
      // No more code blocks; rest is prose
      regions.push({ type: 'prose', text: remaining });
      break;
    }

    // Determine which comes first
    const fenceIdx  = fenceStart  === -1 ? Infinity : fenceStart;
    const indentIdx = indentBlockStart === -1 ? Infinity : indentBlockStart;

    if (fenceIdx <= indentIdx) {
      // Process fenced block
      if (fenceIdx > 0) {
        regions.push({ type: 'prose', text: remaining.slice(0, fenceIdx) });
      }

      // Find the matching closing fence
      const afterOpen     = remaining.indexOf('\n', fenceIdx);
      if (afterOpen === -1) {
        // Unclosed fence — treat rest as prose
        regions.push({ type: 'prose', text: remaining.slice(fenceIdx) });
        break;
      }

      const fenceChar     = remaining[fenceIdx]; // `` ` ``
      const openFenceLen  = remaining.slice(fenceIdx).match(/^`+/)[0].length;
      const closeFenceRe  = new RegExp(`^\`{${openFenceLen},}\\s*$`, 'm');
      const closeFenceIdx = remaining.slice(afterOpen + 1).search(closeFenceRe);

      if (closeFenceIdx === -1) {
        // Unclosed fence — treat from here to end as code (safe)
        regions.push({ type: 'code', text: remaining.slice(fenceIdx) });
        break;
      }

      const afterClose = remaining.indexOf('\n', afterOpen + 1 + closeFenceIdx);
      const blockEnd   = afterClose === -1 ? remaining.length : afterClose + 1;

      regions.push({ type: 'code', text: remaining.slice(fenceIdx, blockEnd) });
      remaining = remaining.slice(blockEnd);

    } else {
      // Process indented block
      if (indentIdx > 0) {
        regions.push({ type: 'prose', text: remaining.slice(0, indentIdx) });
      }

      // Collect consecutive indented lines (4+ spaces or tab)
      const blockEnd = findIndentedBlockEnd(remaining, indentIdx);
      regions.push({ type: 'code', text: remaining.slice(indentIdx, blockEnd) });
      remaining = remaining.slice(blockEnd);
    }
  }

  return regions;
}

/**
 * Find the start index of the first indented code block in text.
 * An indented block is one or more lines starting with 4+ spaces or a tab,
 * preceded by a blank line (or at position 0).
 *
 * Returns -1 if none found.
 * @param {string} text
 * @returns {number}
 */
function findIndentedBlockStart(text) {
  // We look for a blank line followed immediately by an indented line.
  // The blank line can be empty or whitespace-only.
  const re = /(?:^|\n[ \t]*\n)([ \t]{4}[^\n]*)/;
  const m = re.exec(text);
  if (!m) return -1;

  // The indented line starts at m.index + length of everything before group 1
  const lineStart = m.index + m[0].length - m[1].length;
  return lineStart;
}

/**
 * Find the end index of an indented block that starts at `startIdx`.
 * The block ends when a non-indented, non-blank line is encountered.
 * @param {string} text
 * @param {number} startIdx
 * @returns {number}
 */
function findIndentedBlockEnd(text, startIdx) {
  const lines = text.slice(startIdx).split('\n');
  let consumed = startIdx;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    // Blank lines are allowed within indented blocks
    if (line === '' || /^\s*$/.test(line)) {
      // Peek ahead: if the next non-blank line is not indented, stop here
      let j = i + 1;
      while (j < lines.length && /^\s*$/.test(lines[j])) j++;
      if (j >= lines.length || !/^[ \t]{4}/.test(lines[j])) {
        // Block ends at the current blank line(s)
        break;
      }
      // Blank lines are part of the block
      consumed += line.length + 1;
      i++;
    } else if (/^[ \t]{4}/.test(line)) {
      consumed += line.length + 1;
      i++;
    } else {
      break;
    }
  }

  return consumed;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Scan skill content for prompt injection patterns.
 * Code blocks (fenced or 4-space indented) are exempt from scanning.
 *
 * @param {string} content - Raw skill file content
 * @returns {{ safe: true } | { safe: false, violations: Array<{ category: string, pattern: string, snippet: string }> }}
 */
export function checkContent(content) {
  if (typeof content !== 'string') {
    throw new TypeError('content must be a string');
  }

  const regions    = parseRegions(content);
  const violations = [];

  for (const region of regions) {
    if (region.type !== 'prose') continue;

    for (const { category, pattern } of PATTERNS) {
      const match = pattern.exec(region.text);
      if (match) {
        const start   = Math.max(0, match.index - 20);
        const end     = Math.min(region.text.length, match.index + match[0].length + 20);
        const snippet = region.text.slice(start, end).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '?');

        violations.push({
          category,
          pattern: pattern.source,
          snippet,
        });
      }
    }
  }

  if (violations.length === 0) {
    return { safe: true };
  }

  return { safe: false, violations };
}
