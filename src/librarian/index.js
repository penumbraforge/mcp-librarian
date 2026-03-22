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
    };
  }
}
