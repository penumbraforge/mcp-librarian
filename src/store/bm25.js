/**
 * BM25 search engine — zero dependencies.
 * Indexes skill sections (chunked at ### sub-headings) for intelligent retrieval.
 *
 * Improvements over v1:
 * - Chunks large sections at ### sub-headings for finer-grained retrieval
 * - Precomputes TF maps at index time (not per-query)
 * - Basic suffix stripping for better recall (configuring → configur)
 * - Single-char tokens allowed for language names (Go, C, R)
 */

const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'it', 'of', 'in', 'to', 'and', 'or', 'for',
  'on', 'at', 'by', 'with', 'from', 'as', 'be', 'was', 'are', 'were',
  'been', 'has', 'have', 'had', 'do', 'does', 'did', 'will', 'would',
  'can', 'could', 'should', 'may', 'might', 'this', 'that', 'these',
  'those', 'not', 'but', 'if', 'so', 'no', 'all', 'each', 'just',
  'about', 'up', 'out', 'then',
]);

const K1 = 1.5;
const B = 0.75;

// Maximum chunk size in chars before we force-split
const MAX_CHUNK_CHARS = 1500;

/**
 * Basic suffix stripping for better recall.
 * Handles: -ing, -tion, -ed, -ly, -er, -est, -ness, -ment, -able, -ible, -ous, -ive, -ful, -less, -ize, -ise, -ity, -es, -s
 */
function stem(word) {
  if (word.length <= 3) return word;
  // Order matters — try longest suffixes first
  if (word.endsWith('ization') && word.length > 8) return word.slice(0, -7);
  if (word.endsWith('isation') && word.length > 8) return word.slice(0, -7);
  if (word.endsWith('fulness') && word.length > 8) return word.slice(0, -7);
  if (word.endsWith('ousness') && word.length > 8) return word.slice(0, -7);
  if (word.endsWith('iveness') && word.length > 8) return word.slice(0, -7);
  if (word.endsWith('ation') && word.length > 6) return word.slice(0, -5);
  if (word.endsWith('iness') && word.length > 6) return word.slice(0, -5);
  if (word.endsWith('ement') && word.length > 6) return word.slice(0, -5);
  if (word.endsWith('ment') && word.length > 5) return word.slice(0, -4);
  if (word.endsWith('ness') && word.length > 5) return word.slice(0, -4);
  if (word.endsWith('able') && word.length > 5) return word.slice(0, -4);
  if (word.endsWith('ible') && word.length > 5) return word.slice(0, -4);
  if (word.endsWith('less') && word.length > 5) return word.slice(0, -4);
  if (word.endsWith('ting') && word.length > 5) return word.slice(0, -4);
  if (word.endsWith('tion') && word.length > 5) return word.slice(0, -4);
  if (word.endsWith('sion') && word.length > 5) return word.slice(0, -4);
  if (word.endsWith('ize') && word.length > 4) return word.slice(0, -3);
  if (word.endsWith('ise') && word.length > 4) return word.slice(0, -3);
  if (word.endsWith('ity') && word.length > 4) return word.slice(0, -3);
  if (word.endsWith('ous') && word.length > 4) return word.slice(0, -3);
  if (word.endsWith('ive') && word.length > 4) return word.slice(0, -3);
  if (word.endsWith('ful') && word.length > 4) return word.slice(0, -3);
  if (word.endsWith('ing') && word.length > 4) return word.slice(0, -3);
  if (word.endsWith('ent') && word.length > 4) return word.slice(0, -3);
  if (word.endsWith('ant') && word.length > 4) return word.slice(0, -3);
  if (word.endsWith('ist') && word.length > 4) return word.slice(0, -3);
  if (word.endsWith('ism') && word.length > 4) return word.slice(0, -3);
  if (word.endsWith('ed') && word.length > 3) return word.slice(0, -2);
  if (word.endsWith('ly') && word.length > 3) return word.slice(0, -2);
  if (word.endsWith('er') && word.length > 3) return word.slice(0, -2);
  if (word.endsWith('al') && word.length > 3) return word.slice(0, -2);
  if (word.endsWith('es') && word.length > 3) return word.slice(0, -2);
  if (word.endsWith('s') && word.length > 3 && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

function tokenize(text) {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(t => t.length > 0 && !STOPWORDS.has(t))
    .map(stem);
}

/**
 * Chunk a section at ### sub-headings.
 * Each chunk inherits the parent ## heading as context.
 */
function chunkSection(section) {
  const { heading, body, skill } = section;

  // Split on ### sub-headings
  const parts = body.split(/^(?=### )/m);

  if (parts.length <= 1 && body.length <= MAX_CHUNK_CHARS) {
    // Small section with no sub-headings — return as-is
    return [section];
  }

  const chunks = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    const subMatch = trimmed.match(/^### (.+)/);
    const subHeading = subMatch ? subMatch[1].trim() : null;
    const chunkBody = subMatch ? trimmed.slice(subMatch[0].length).trim() : trimmed;

    // If a sub-chunk is still too large, split on blank lines
    if (chunkBody.length > MAX_CHUNK_CHARS) {
      const paragraphs = chunkBody.split(/\n\n+/);
      let buf = '';
      for (const para of paragraphs) {
        if (buf.length + para.length > MAX_CHUNK_CHARS && buf.length > 0) {
          chunks.push({
            heading: subHeading ? `${heading} > ${subHeading}` : heading,
            body: buf.trim(),
            skill,
            parentHeading: heading,
          });
          buf = '';
        }
        buf += para + '\n\n';
      }
      if (buf.trim()) {
        chunks.push({
          heading: subHeading ? `${heading} > ${subHeading}` : heading,
          body: buf.trim(),
          skill,
          parentHeading: heading,
        });
      }
    } else if (chunkBody) {
      chunks.push({
        heading: subHeading ? `${heading} > ${subHeading}` : heading,
        body: chunkBody,
        skill,
        parentHeading: heading,
      });
    }
  }

  return chunks.length > 0 ? chunks : [section];
}

export class BM25 {
  constructor() {
    this.docs = [];       // [{ tokens, tf, meta }]
    this.idf = new Map(); // term → idf score
    this.avgDl = 0;
  }

  index(sections) {
    this.docs = [];
    const df = new Map(); // term → number of docs containing it

    // Chunk sections at ### sub-headings before indexing
    const allChunks = [];
    for (const section of sections) {
      allChunks.push(...chunkSection(section));
    }

    for (const chunk of allChunks) {
      const text = `${chunk.heading} ${chunk.body}`;
      const tokens = tokenize(text);
      const uniqueTerms = new Set(tokens);

      // Precompute TF map at index time
      const tf = new Map();
      for (const t of tokens) {
        tf.set(t, (tf.get(t) || 0) + 1);
      }

      this.docs.push({ tokens, tf, meta: chunk });
      for (const term of uniqueTerms) {
        df.set(term, (df.get(term) || 0) + 1);
      }
    }

    const N = this.docs.length;
    this.avgDl = N > 0 ? this.docs.reduce((s, d) => s + d.tokens.length, 0) / N : 0;

    // Compute IDF: log((N - df + 0.5) / (df + 0.5) + 1)
    this.idf.clear();
    for (const [term, freq] of df) {
      this.idf.set(term, Math.log((N - freq + 0.5) / (freq + 0.5) + 1));
    }
  }

  search(query, topK = 5) {
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0 || this.docs.length === 0) return [];

    const scores = [];

    for (let i = 0; i < this.docs.length; i++) {
      const doc = this.docs[i];
      const dl = doc.tokens.length;
      let score = 0;

      for (const qt of queryTokens) {
        const idf = this.idf.get(qt) || 0;
        const f = doc.tf.get(qt) || 0;
        if (f === 0) continue;
        // BM25 score for this term
        score += idf * (f * (K1 + 1)) / (f + K1 * (1 - B + B * dl / this.avgDl));
      }

      if (score > 0) {
        scores.push({ score, meta: doc.meta });
      }
    }

    scores.sort((a, b) => b.score - a.score);
    return scores.slice(0, topK);
  }

  get documentCount() {
    return this.docs.length;
  }
}

// Export for testing
export { tokenize, stem, chunkSection };
