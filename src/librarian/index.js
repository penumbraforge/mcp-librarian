/**
 * Librarian orchestrator: scheduled maintenance + on-demand AI curation.
 */

import { scanSkillsDir } from './indexer.js';
import { validateSkill } from './validator.js';
import { guardContent } from './content-guard.js';
import { checkStaleness } from './staleness.js';
import { IntegrityEngine } from './integrity.js';
import { StagingArea } from './staging.js';
import * as ai from './ai-curator.js';
import { scoreSkill } from '../store/quality-scorer.js';

const MAINTENANCE_INTERVAL_MS = 5 * 60 * 1000; // 5 min

export class Librarian {
  constructor(opts) {
    this.skillsDir = opts.skillsDir;
    this.stagingDir = opts.stagingDir;
    this.store = opts.store;
    this.auditLog = opts.auditLog;
    this.integrity = new IntegrityEngine(
      opts.skillsDir,
      opts.publicKey,
      opts.privateKey
    );
    if (opts.manifestPath) {
      this.integrity.manifestPath = opts.manifestPath;
    }
    this.staging = new StagingArea(opts.stagingDir, opts.skillsDir);
    this.timer = null;
    this.lastRun = null;
    this.issues = [];
  }

  start() {
    this.runMaintenance();
    this.timer = setInterval(() => this.runMaintenance(), MAINTENANCE_INTERVAL_MS);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  runMaintenance() {
    try {
      const skills = scanSkillsDir(this.skillsDir);
      const manifest = this.integrity.loadManifest();
      this.issues = [];

      // Validate + guard each skill
      for (const [name, { parsed, content }] of Object.entries(skills)) {
        const validation = validateSkill(parsed);
        if (!validation.valid) {
          this.issues.push({ skill: name, type: 'validation', issues: validation.issues });
        }

        const guard = guardContent(content);
        if (!guard.safe) {
          this.issues.push({ skill: name, type: 'content_guard', issues: guard.issues });
        }

        const integrity = this.integrity.verifySkill(name, content, manifest);
        if (integrity.status === 'TAMPERED') {
          this.issues.push({ skill: name, type: 'integrity', status: integrity });
        }
      }

      // Check staleness
      const stale = checkStaleness(manifest);
      for (const s of stale) {
        this.issues.push({ skill: s.name, type: 'staleness', ...s });
      }

      // Rebuild store index
      this.store.loadAll();

      // Heuristic quality scoring pass
      const updatedManifest = this.integrity.loadManifest();
      let scoredCount = 0;
      for (const [name, { content, parsed }] of Object.entries(skills)) {
        const entry = updatedManifest.skills?.[name];
        if (!entry) continue;

        // Skip if already scored and content unchanged
        if (entry.quality && entry.quality._forHash === entry.sha256) continue;

        const sources = parsed.frontmatter?.sources || [];
        const detailed = scoreSkill(content, sources, { detailed: true });
        entry.quality = {
          ...detailed,
          scored_by: 'heuristic',
          scored_at: new Date().toISOString(),
          _forHash: entry.sha256,
        };
        scoredCount++;
      }
      if (scoredCount > 0) {
        this.integrity.saveManifest(updatedManifest);
        // Reload store to pick up new quality scores
        this.store.loadAll();
      }

      // Async LLM scoring upgrade (non-blocking, best-effort)
      this._runLLMScoring(skills, updatedManifest).catch(() => {});

      this.lastRun = new Date().toISOString();
      this.auditLog?.log({
        event: 'maintenance',
        skillCount: Object.keys(skills).length,
        issueCount: this.issues.length,
      });
    } catch (e) {
      console.error(`[librarian] Maintenance error: ${e.message}`);
      this.auditLog?.log({ event: 'maintenance_error', error: e.message });
    }
  }

  async curate(action, opts = {}) {
    const skillSummaries = this.store.listSkills();

    switch (action) {
      case 'analyze': {
        if (!opts.skill) throw new Error('skill is required for analyze');
        const parsed = this.store.skills.get(opts.skill);
        if (!parsed) throw new Error(`Skill "${opts.skill}" not found`);
        const result = await ai.analyzeSkill(parsed);
        return { action, skill: opts.skill, analysis: result };
      }

      case 'suggest_improvements': {
        if (!opts.skill) throw new Error('skill is required for suggest_improvements');
        const parsed = this.store.skills.get(opts.skill);
        if (!parsed) throw new Error(`Skill "${opts.skill}" not found`);
        const result = await ai.suggestImprovements(parsed);
        return { action, skill: opts.skill, suggestions: result };
      }

      case 'find_gaps': {
        const result = await ai.findGaps(skillSummaries, opts.topic);
        return { action, gaps: result };
      }

      case 'deduplicate': {
        const result = await ai.deduplicateAnalysis(skillSummaries);
        return { action, analysis: result };
      }

      case 'draft_skill': {
        if (!opts.topic) throw new Error('topic is required for draft_skill');
        const existing = skillSummaries.map(s => s.name);
        const draft = await ai.draftSkill(opts.topic, existing);

        // Stage it
        const name = opts.topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
        const stageResult = this.staging.stage(name, draft);

        this.auditLog?.log({
          event: 'draft_staged',
          skill: name,
          staged: stageResult.staged,
        });

        return { action, skill: name, ...stageResult, content_preview: draft.slice(0, 500) };
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  previewPromotion(skillName) {
    return this.staging.getLiveDiff(skillName);
  }

  promote(skillName) {
    const result = this.staging.promoteToLive(skillName);

    // Re-sign
    const skills = scanSkillsDir(this.skillsDir);
    const contents = {};
    for (const [name, { content }] of Object.entries(skills)) {
      contents[name] = content;
    }
    this.integrity.signAll(contents);

    // Reload store
    this.store.loadAll();

    this.auditLog?.log({
      event: 'promote',
      skill: skillName,
    });

    return result;
  }

  getStatus() {
    return {
      lastRun: this.lastRun,
      issues: this.issues,
      staging: this.staging.list(),
      skillCount: this.store.skills.size,
      indexedChunks: this.store.bm25.documentCount,
      expertiseSummary: this.store.buildExpertiseSummary(),
    };
  }

  async _runLLMScoring(skills, manifest) {
    const needsLLM = [];
    for (const [name, { content, parsed }] of Object.entries(skills)) {
      const entry = manifest.skills?.[name];
      if (entry?.quality?.scored_by === 'heuristic') {
        needsLLM.push({ name, content, description: parsed.frontmatter?.description });
      }
    }
    if (needsLLM.length === 0) return;

    for (let i = 0; i < needsLLM.length; i += 5) {
      const batch = needsLLM.slice(i, i + 5);
      const scores = await ai.scoreSkillsWithLLM(batch);
      if (!scores) continue;

      const reloadManifest = this.integrity.loadManifest();
      for (const s of scores) {
        const entry = reloadManifest.skills?.[s.id];
        if (!entry?.quality) continue;
        const spec = parseFloat(s.specificity);
        const ex = parseFloat(s.examples);
        const act = parseFloat(s.actionability);
        if ([spec, ex, act].some(v => isNaN(v) || v < 0 || v > 1)) continue;

        const srcRep = entry.quality.source_reputation ?? 0.5;
        entry.quality.specificity = spec;
        entry.quality.examples = ex;
        entry.quality.actionability = act;
        entry.quality.score = Math.round((0.7 * (spec + ex + act) / 3 + 0.3 * srcRep) * 10000) / 10000;
        entry.quality.scored_by = 'llm';
        entry.quality.scored_at = new Date().toISOString();
      }
      this.integrity.saveManifest(reloadManifest);
    }

    this.store.loadAll();
  }
}
