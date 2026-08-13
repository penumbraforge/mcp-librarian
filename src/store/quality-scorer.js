/**
 * Heuristic quality scorer — 4 dimensions, zero dependencies.
 * Port of umbrav2's knowledge_quality.py scoring logic.
 */
import { scoreSource } from './source-reputation.js';

const CONCRETE_RE = /[a-z]+[A-Z]|_[a-z]|^--?[a-z]|\./;
const IMPERATIVE_RE = /^(Run|Add|Create|Install|Set|Open|Copy|Move|Delete|Update|Enable|Disable|Configure|Build|Deploy|Start|Stop)\b/m;
const CONTENT_WEIGHT = 0.7;
const SOURCE_WEIGHT = 0.3;
const DEFAULT_SOURCE_REPUTATION = 0.5;

export function scoreSpecificity(content) {
  if (!content) return 0.0;
  const tokens = content.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return 0.0;
  const concrete = tokens.filter(t => CONCRETE_RE.test(t)).length;
  return Math.min(1.0, concrete / tokens.length * 2.5);
}

export function scoreExamples(content) {
  if (!content) return 0.0;
  const fencedBlocks = (content.match(/```/g) || []).length / 2;
  const inlineCode = (content.match(/`[^`]+`/g) || []).length;
  return Math.min(1.0, fencedBlocks * 0.15 + inlineCode * 0.03);
}

export function scoreActionability(content) {
  if (!content) return 0.0;
  const lines = content.split('\n');
  const numbered = lines.filter(l => /^\d+\.\s/.test(l.trim())).length;
  const imperatives = lines.filter(l => IMPERATIVE_RE.test(l.trim())).length;
  const commands = (content.match(/```(?:bash|sh|shell|zsh)\n/g) || []).length;
  return Math.min(1.0, numbered * 0.09 + imperatives * 0.06 + commands * 0.1);
}

export function scoreSkill(content, sources, opts = {}) {
  if (!content || content.trim().length === 0) {
    return opts.detailed ? { score: 0.0, specificity: 0.0, examples: 0.0, actionability: 0.0, source_reputation: 0.0 } : 0.0;
  }
  const specificity = scoreSpecificity(content);
  const examples = scoreExamples(content);
  const actionability = scoreActionability(content);
  let sourceReputation = DEFAULT_SOURCE_REPUTATION;
  if (sources && sources.length > 0) {
    const scores = sources.map(u => scoreSource(u)).filter(s => s > 0);
    if (scores.length > 0) sourceReputation = Math.max(...scores);
  }
  const contentAvg = (specificity + examples + actionability) / 3;
  const score = Math.round((CONTENT_WEIGHT * contentAvg + SOURCE_WEIGHT * sourceReputation) * 10000) / 10000;
  if (opts.detailed) {
    return { score, specificity, examples, actionability, source_reputation: sourceReputation };
  }
  return score;
}
