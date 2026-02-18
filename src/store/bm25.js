/**
 * BM25 search engine — zero dependencies, ~60 lines of logic.
 * Indexes skill sections for intelligent retrieval.
 */

const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'it', 'of', 'in', 'to', 'and', 'or', 'for',
  'on', 'at', 'by', 'with', 'from', 'as', 'be', 'was', 'are', 'were',
  'been', 'has', 'have', 'had', 'do', 'does', 'did', 'will', 'would',
  'can', 'could', 'should', 'may', 'might', 'this', 'that', 'these',
  'those', 'i', 'you', 'he', 'she', 'we', 'they', 'not', 'but', 'if',
  'so', 'no', 'all', 'each', 'just', 'about', 'up', 'out', 'then',
]);

const K1 = 1.5;
const B = 0.75;

function tokenize(text) {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(t => t.length > 1 && !STOPWORDS.has(t));
}

export class BM25 {
  constructor() {
    this.docs = [];       // [{ tokens, meta }]
    this.idf = new Map(); // term → idf score
    this.avgDl = 0;
  }

  index(sections) {
    this.docs = [];
    const df = new Map(); // term → number of docs containing it

    for (const section of sections) {
      const text = `${section.heading} ${section.body}`;
      const tokens = tokenize(text);
      const uniqueTerms = new Set(tokens);
      this.docs.push({ tokens, meta: section });
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

      // Build term frequency map for this doc
      const tf = new Map();
      for (const t of doc.tokens) {
        tf.set(t, (tf.get(t) || 0) + 1);
      }

      for (const qt of queryTokens) {
        const idf = this.idf.get(qt) || 0;
        const f = tf.get(qt) || 0;
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
