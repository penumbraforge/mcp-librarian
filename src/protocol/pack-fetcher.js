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

// Hosts that may receive the user's GITHUB_TOKEN. Anything else gets an
// anonymous request — install_pack accepts caller-supplied URLs, and a token
// attached unconditionally is a one-call credential exfiltration primitive.
const GITHUB_TOKEN_HOSTS = new Set([
  'raw.githubusercontent.com',
  'api.github.com',
]);

// Hosts a direct pack URL may point at (unless allowArbitraryPackUrls).
const PACK_URL_HOSTS = new Set(['raw.githubusercontent.com']);

// Hard ceiling on a fetched pack/skill body. Enforced while streaming —
// buffering an unbounded body and truncating afterwards is an OOM vector.
const MAX_FETCH_BYTES = 2 * 1024 * 1024;

// ---------------------------------------------------------------------------
// PackFetcher
// ---------------------------------------------------------------------------

export class PackFetcher {
  /**
   * @param {{ skillsRepo: string, allowArbitraryPackUrls?: boolean }} config
   *   skillsRepo — e.g. "penumbraforge/mcp-librarian-skills"
   */
  constructor(config) {
    this._repo = config.skillsRepo;
    this._allowArbitraryPackUrls = config.allowArbitraryPackUrls === true;
    this._baseUrl = null; // Set when using direct URL mode
  }

  /**
   * Fetch and parse pack.json for a named pack.
   * If directUrl is provided, fetches from that URL instead of the default repo.
   *
   * @param {string} packName
   * @param {string} [directUrl]  - Direct URL to pack.json
   * @returns {Promise<object>} Parsed JSON object
   */
  async fetchPackJson(packName, directUrl) {
    if (directUrl) this._validateDirectUrl(directUrl);

    const url = directUrl || `https://raw.githubusercontent.com/${this._repo}/main/packs/${packName}/pack.json`;

    // Store the base URL so fetchSkillFile can resolve relative paths
    if (directUrl) {
      this._baseUrl = directUrl.replace(/\/pack\.json$/, '');
    }

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
    const base = this._baseUrl || `https://raw.githubusercontent.com/${this._repo}/main/packs/${packName}`;
    const url = `${base}/${filename}`;
    return this._fetch(url);
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  /**
   * Reject direct pack URLs that don't point at an allowlisted host.
   * Escape hatch: config.allowArbitraryPackUrls (explicit user opt-in).
   */
  _validateDirectUrl(directUrl) {
    let parsed;
    try {
      parsed = new URL(directUrl);
    } catch {
      throw new McpError(ERROR_CODES.INVALID_INPUT, `Invalid pack URL: ${directUrl}`);
    }
    if (this._allowArbitraryPackUrls) return;
    if (parsed.protocol !== 'https:' || !PACK_URL_HOSTS.has(parsed.hostname)) {
      throw new McpError(
        ERROR_CODES.INVALID_INPUT,
        `Pack URLs must point at ${[...PACK_URL_HOSTS].join(', ')} over https. ` +
        `Set allowArbitraryPackUrls: true in config to override (the request will be sent without credentials).`,
        { url: directUrl }
      );
    }
  }

  /**
   * Perform a GET request and return the response body as a string.
   * Handles GitHub auth (allowlisted hosts only), timeouts, size caps,
   * and status code errors.
   *
   * @param {string} url
   * @returns {Promise<string>}
   */
  _fetch(url) {
    return new Promise((resolve, reject) => {
      let hostname;
      try {
        hostname = new URL(url).hostname;
      } catch {
        return reject(new McpError(ERROR_CODES.PACK_FETCH_FAILED, `Invalid URL: ${url}`));
      }

      const headers = { 'User-Agent': 'mcp-librarian/3.0.0' };
      if (process.env.GITHUB_TOKEN && GITHUB_TOKEN_HOSTS.has(hostname)) {
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

        // Collect response body. Buffer.concat (not chunks.join) — joining
        // Buffers stringifies each chunk separately and corrupts any
        // multi-byte UTF-8 character that straddles a chunk boundary.
        const chunks = [];
        let received = 0;
        res.on('data', (chunk) => {
          received += chunk.length;
          if (received > MAX_FETCH_BYTES) {
            req.destroy();
            return reject(new McpError(
              ERROR_CODES.PACK_FETCH_FAILED,
              `Response exceeded ${MAX_FETCH_BYTES} bytes fetching: ${url}`,
              { url, maxBytes: MAX_FETCH_BYTES }
            ));
          }
          chunks.push(chunk);
        });
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
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
