import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const DEFAULTS = {
  logLevel: 'info',
  rateLimit: 200,
  cacheSize: 100,
  cacheTtl: 600000,
  skillsRepo: 'penumbraforge/mcp-librarian-skills',
  // Opt-in web research. When false (default), find_and_load never reaches
  // out to the network on a weak match — it returns found:false and suggests
  // research_topic. Auto-fetching arbitrary web pages and funneling them into
  // skill creation is a prompt-injection surface; it should be a deliberate
  // choice, not a silent default.
  autoResearch: false,
  // Quality-weighted retrieval: blend BM25 relevance with a heuristic skill
  // quality score. Off → pure BM25 (bit-identical to legacy behavior).
  qualityWeighting: true,
  qualityWeight: 0.4,
  // Allow install_pack to fetch pack.json from non-raw.githubusercontent.com
  // URLs (sent without credentials). Off by default.
  allowArbitraryPackUrls: false,
};

const VALID_LOG_LEVELS = ['debug', 'info', 'warning', 'error'];

/**
 * Load and merge config from file and environment variables.
 * Invalid values fall back to defaults and are recorded in config._warnings.
 * @param {string} home - The librarian home directory
 * @returns {Promise<object>} Resolved config object
 */
export async function loadConfig(home) {
  const warnings = [];
  let fileConfig = {};

  // Read config file if present
  try {
    const raw = await readFile(join(home, 'config.json'), 'utf8');
    fileConfig = JSON.parse(raw);
  } catch {
    // Missing or unreadable config file is fine — use defaults
  }

  // Merge: defaults < file < env vars
  const merged = { ...DEFAULTS, ...fileConfig };

  // --- logLevel ---
  const envLogLevel = process.env.MCP_LIBRARIAN_LOG_LEVEL;
  if (envLogLevel !== undefined) {
    if (VALID_LOG_LEVELS.includes(envLogLevel)) {
      merged.logLevel = envLogLevel;
    } else {
      warnings.push(`Invalid MCP_LIBRARIAN_LOG_LEVEL "${envLogLevel}"; using default "${DEFAULTS.logLevel}"`);
      merged.logLevel = DEFAULTS.logLevel;
    }
  } else if (merged.logLevel !== undefined && !VALID_LOG_LEVELS.includes(merged.logLevel)) {
    warnings.push(`Invalid logLevel "${merged.logLevel}" in config file; using default "${DEFAULTS.logLevel}"`);
    merged.logLevel = DEFAULTS.logLevel;
  }

  // --- rateLimit ---
  const envRateLimit = process.env.MCP_LIBRARIAN_RATE_LIMIT;
  if (envRateLimit !== undefined) {
    const parsed = Number(envRateLimit);
    if (Number.isFinite(parsed) && parsed > 0) {
      merged.rateLimit = parsed;
    } else {
      warnings.push(`Invalid MCP_LIBRARIAN_RATE_LIMIT "${envRateLimit}"; using default ${DEFAULTS.rateLimit}`);
      merged.rateLimit = DEFAULTS.rateLimit;
    }
  }

  // --- cacheSize ---
  const envCacheSize = process.env.MCP_LIBRARIAN_CACHE_SIZE;
  if (envCacheSize !== undefined) {
    const parsed = Number(envCacheSize);
    if (Number.isFinite(parsed) && parsed > 0) {
      merged.cacheSize = parsed;
    } else {
      warnings.push(`Invalid MCP_LIBRARIAN_CACHE_SIZE "${envCacheSize}"; using default ${DEFAULTS.cacheSize}`);
      merged.cacheSize = DEFAULTS.cacheSize;
    }
  }

  // --- cacheTtl ---
  const envCacheTtl = process.env.MCP_LIBRARIAN_CACHE_TTL;
  if (envCacheTtl !== undefined) {
    const parsed = Number(envCacheTtl);
    if (Number.isFinite(parsed) && parsed > 0) {
      merged.cacheTtl = parsed;
    } else {
      warnings.push(`Invalid MCP_LIBRARIAN_CACHE_TTL "${envCacheTtl}"; using default ${DEFAULTS.cacheTtl}`);
      merged.cacheTtl = DEFAULTS.cacheTtl;
    }
  }

  // --- skillsRepo ---
  const envSkillsRepo = process.env.MCP_LIBRARIAN_SKILLS_REPO;
  if (envSkillsRepo !== undefined) {
    merged.skillsRepo = envSkillsRepo;
  }

  // --- autoResearch (env override: "1"/"true" enables) ---
  const envAutoResearch = process.env.MCP_LIBRARIAN_AUTO_RESEARCH;
  if (envAutoResearch !== undefined) {
    merged.autoResearch = envAutoResearch === '1' || envAutoResearch.toLowerCase() === 'true';
  }

  // --- qualityWeight (0..1) ---
  const envQualityWeight = process.env.MCP_LIBRARIAN_QUALITY_WEIGHT;
  if (envQualityWeight !== undefined) {
    const parsed = Number(envQualityWeight);
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) {
      merged.qualityWeight = parsed;
    } else {
      warnings.push(`Invalid MCP_LIBRARIAN_QUALITY_WEIGHT "${envQualityWeight}"; using ${DEFAULTS.qualityWeight}`);
      merged.qualityWeight = DEFAULTS.qualityWeight;
    }
  }

  return {
    ...merged,
    home,
    _warnings: warnings,
  };
}
