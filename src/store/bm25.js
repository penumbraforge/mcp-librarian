/**
 * BM25 full-text search index with Porter-style stemming and sub-section chunking.
 */

const STOPWORDS = new Set([
  'the', 'is', 'at', 'which', 'on', 'a', 'an', 'and', 'or', 'but',
  'in', 'with', 'to', 'for', 'of', 'it', 'this', 'that', 'from',
  'by', 'as', 'be', 'was', 'were', 'are', 'been', 'have', 'has',
  'had', 'do', 'does', 'did', 'will', 'would', 'can', 'could', 'may',
  'might', 'shall', 'should', 'not', 'no', 'so', 'if', 'than', 'too',
  'very', 'just', 'about',
]);

const BM25_K1 = 1.5;
const BM25_B  = 0.75;
const SNIPPET_LEN = 200;

/**
 * Porter-style suffix stripping. Keeps at least 3 chars.
 * Suffixes tried longest-first to avoid over-stemming.
 */
export function stem(word) {
  // Ordered longest→shortest so we don't over-strip
  const suffixes = [
    'ation', 'ance', 'ence', 'ness', 'ment', 'ible', 'able',
    'tion', 'ize', 'ise', 'ity', 'ive', 'ful', 'ing', 'ous',
    'less', 'est', 'ify', 'fy', 'en', 'al', 'er', 'ly', 'ed', 's',
  ];

  for (const suffix of suffixes) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 3) {
      return word.slice(0, word.length - suffix.length);
    }
  }
  return word;
}

/**
 * Tokenize text: split on non-alphanumeric, lowercase, filter stopwords, stem.
 */
export function tokenize(text) {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(t => t.length >= 2 && !STOPWORDS.has(t))
    .map(stem);
}

/**
 * Convert heading text to a slug (lowercase, spaces → hyphens).
 */
function slugify(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

/**
 * Parse markdown into BM25-indexable chunks.
 *
 * Rules:
 * - Each ## section with no ### children → one chunk
 * - ## with ### children:
 *   - intro text before first ### → chunk if non-empty (section slug = parent slug)
 *   - each ### → its own chunk (section slug = parent/child)
 * - Chunks include their heading text
 * - Returns [{ section, content }]
 */
export function parseSkillSections(content) {
  const lines = content.split('\n');
  const chunks = [];

  let currentH2Slug = null;
  let currentH3Slug = null;
  let buffer = [];

  const flushBuffer = () => {
    if (!currentH2Slug) return;
    const text = buffer.join('\n').trim();
    if (!text) return;

    // For ## intro buffers (no current h3), only emit if there's body text
    // beyond the heading line itself. Otherwise the ## had only whitespace
    // before the first ### and should produce no intro chunk.
    if (!currentH3Slug) {
      const linesWithoutHeading = buffer.slice(1).join('\n').trim();
      if (!linesWithoutHeading) return;
    }

    const section = currentH3Slug
      ? `${currentH2Slug}/${currentH3Slug}`
      : currentH2Slug;

    chunks.push({ section, content: text });
  };

  for (const line of lines) {
    const h2Match = line.match(/^## (.+)/);
    const h3Match = line.match(/^### (.+)/);

    if (h2Match) {
      flushBuffer();
      currentH2Slug = slugify(h2Match[1]);
      currentH3Slug = null;
      buffer = [line];
    } else if (h3Match) {
      flushBuffer();
      currentH3Slug = slugify(h3Match[1]);
      buffer = [line];
    } else {
      buffer.push(line);
    }
  }

  flushBuffer();

  return chunks;
}

/**
 * BM25 inverted index.
 *
 * Internal structure:
 *   chunks: Array<{ skill, section, content, tokens: string[] }>
 *   invertedIndex: Map<term, Set<chunkIndex>>
 *   df: Map<term, number>  — document frequency
 */
export class BM25Index {
  #chunks;
  #invertedIndex;
  #df;

  constructor() {
    this.#chunks = [];
    this.#invertedIndex = new Map();
    this.#df = new Map();
  }

  /**
   * Add a chunk to the index.
   */
  add(skill, section, content) {
    const tokens = tokenize(content);
    const idx = this.#chunks.length;

    // Precompute term frequencies once at index time. The search loop
    // previously did chunk.tokens.filter(t => t === term).length per query
    // term per matching chunk — a full O(n) rescan of the token array inside
    // the hot loop. A TF map makes it an O(1) lookup.
    const tf = new Map();
    for (const t of tokens) {
      tf.set(t, (tf.get(t) ?? 0) + 1);
    }

    this.#chunks.push({ skill, section, content, length: tokens.length, tf });

    // Track which terms appear in this document (for DF)
    const seenTerms = tf.keys();

    for (const term of seenTerms) {
      // Update inverted index
      if (!this.#invertedIndex.has(term)) {
        this.#invertedIndex.set(term, new Set());
      }
      this.#invertedIndex.get(term).add(idx);

      // Update document frequency
      this.#df.set(term, (this.#df.get(term) ?? 0) + 1);
    }
  }

  /**
   * BM25 search.
   * Returns [{ skill, section, score, snippet }] sorted by score descending.
   */
  search(query, limit = 10) {
    const queryTerms = tokenize(query);
    if (queryTerms.length === 0) return [];

    const N = this.#chunks.length;
    if (N === 0) return [];

    // Compute average document length
    const avgDL = this.#chunks.reduce((sum, c) => sum + c.length, 0) / N;

    // Accumulate BM25 scores
    const scores = new Map(); // chunkIndex → score

    for (const term of queryTerms) {
      const df = this.#df.get(term) ?? 0;
      if (df === 0) continue;

      // IDF component: log((N - df + 0.5) / (df + 0.5) + 1)
      const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);

      const matchingChunks = this.#invertedIndex.get(term) ?? new Set();

      for (const chunkIdx of matchingChunks) {
        const chunk = this.#chunks[chunkIdx];
        const dl = chunk.length;

        // TF: O(1) lookup from the precomputed map
        const tf = chunk.tf.get(term) ?? 0;

        // BM25 TF component
        const tfComponent = (tf * (BM25_K1 + 1)) / (tf + BM25_K1 * (1 - BM25_B + BM25_B * dl / avgDL));

        const contribution = idf * tfComponent;
        scores.set(chunkIdx, (scores.get(chunkIdx) ?? 0) + contribution);
      }
    }

    if (scores.size === 0) return [];

    // Sort by score descending, apply limit
    return [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([chunkIdx, score]) => {
        const { skill, section, content } = this.#chunks[chunkIdx];
        const snippet = content.length > SNIPPET_LEN
          ? content.slice(0, SNIPPET_LEN)
          : content;
        return { skill, section, score, snippet };
      });
  }

  /**
   * Reset the index.
   */
  clear() {
    this.#chunks = [];
    this.#invertedIndex = new Map();
    this.#df = new Map();
  }

  /**
   * Returns { chunkCount, uniqueTerms }.
   */
  stats() {
    return {
      chunkCount: this.#chunks.length,
      uniqueTerms: this.#invertedIndex.size,
    };
  }
}
