/**
 * PackFetcher — fetches pack.json and skill files from a GitHub repository
 * using raw.githubusercontent.com.
 *
 * Zero dependencies — uses node:https only.
 *
 * @module pack-fetcher
 */

import { get } from 'node:https';

import { McpError, ERROR_CODES } from '../errors.js';

// ---------------------------------------------------------------------------
// PackFetcher
// ---------------------------------------------------------------------------

export class PackFetcher {
  /**
   * @param {{ skillsRepo: string }} config
   *   skillsRepo — e.g. "penumbraforge/mcp-librarian-skills"
   */
  constructor(config) {
    this._repo = config.skillsRepo;
  }

  /**
   * Fetch and parse pack.json for a named pack.
   *
   * @param {string} packName
   * @returns {Promise<object>} Parsed JSON object
   */
  async fetchPackJson(packName) {
    const url = `https://raw.githubusercontent.com/${this._repo}/main/packs/${packName}/pack.json`;
    const body = await this._fetch(url);
    try {
      return JSON.parse(body);
    } catch {
      throw new McpError(
        ERROR_CODES.PACK_FETCH_FAILED,
        `pack.json for "${packName}" is not valid JSON`,
        { packName, url }
      );
    }
  }

  /**
   * Fetch a raw skill file from a pack.
   *
   * @param {string} packName
   * @param {string} filename
   * @returns {Promise<string>} Raw file content
   */
  async fetchSkillFile(packName, filename) {
    const url = `https://raw.githubusercontent.com/${this._repo}/main/packs/${packName}/${filename}`;
    return this._fetch(url);
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  /**
   * Perform a GET request and return the response body as a string.
   * Handles GitHub auth, timeouts, and status code errors.
   *
   * @param {string} url
   * @returns {Promise<string>}
   */
  _fetch(url) {
    return new Promise((resolve, reject) => {
      const headers = { 'User-Agent': 'mcp-librarian/3.0.0' };
      if (process.env.GITHUB_TOKEN) {
        headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`;
      }

      const req = get(url, { headers, timeout: 10000 }, (res) => {
        // Handle status codes before collecting body
        if (res.statusCode === 404) {
          res.resume(); // Drain response to free socket
          return reject(new McpError(
            ERROR_CODES.PACK_NOT_FOUND,
            `Pack not found at: ${url}`,
            { url, status: 404 }
          ));
        }

        if (res.statusCode === 403) {
          // Drain first, then check for rate-limit headers
          const rateLimitRemaining = res.headers['x-ratelimit-remaining'];
          const rateLimitReset     = res.headers['x-ratelimit-reset'];
          res.resume();

          const resetMsg = rateLimitReset
            ? ` Rate limit resets at ${new Date(Number(rateLimitReset) * 1000).toISOString()}.`
            : '';

          return reject(new McpError(
            ERROR_CODES.PACK_FETCH_FAILED,
            `GitHub rate limit exceeded.${resetMsg} Set GITHUB_TOKEN env var to increase your limit.`,
            { url, status: 403, rateLimitRemaining, rateLimitReset }
          ));
        }

        if (res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          return reject(new McpError(
            ERROR_CODES.PACK_FETCH_FAILED,
            `Unexpected HTTP status ${res.statusCode} fetching: ${url}`,
            { url, status: res.statusCode }
          ));
        }

        // Collect response body
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve(chunks.join('')));
        res.on('error', (err) => {
          reject(new McpError(
            ERROR_CODES.PACK_FETCH_FAILED,
            `Response stream error: ${err.message}`,
            { url, error: err.message }
          ));
        });
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new McpError(
          ERROR_CODES.PACK_FETCH_FAILED,
          `Request timed out after 10s fetching: ${url}`,
          { url }
        ));
      });

      req.on('error', (err) => {
        reject(new McpError(
          ERROR_CODES.PACK_FETCH_FAILED,
          `Network error fetching "${url}": ${err.message}`,
          { url, error: err.message }
        ));
      });
    });
  }
}
