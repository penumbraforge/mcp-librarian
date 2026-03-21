/**
 * McpLogger — sends MCP logging notifications over the transport.
 *
 * MCP spec: servers may emit `notifications/message` JSON-RPC notifications
 * to communicate log events to the client. Only messages at or above the
 * active log level are emitted.
 *
 * Log level hierarchy (ascending severity):
 *   debug=0 < info=1 < warning=2 < error=3
 */

const LEVELS = { debug: 0, info: 1, warning: 2, error: 3 };
const VALID_LEVELS = Object.keys(LEVELS);

export class McpLogger {
  #transport;
  #level;

  /**
   * @param {object} transport  - must expose send(object)
   * @param {string} [level]    - initial log level (default 'info')
   */
  constructor(transport, level = 'info') {
    this.#transport = transport;
    this.#level = this.#parseLevel(level);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Change the active log level.
   * @param {string} level - one of debug/info/warning/error
   * @throws {Error} if level is invalid
   */
  setLevel(level) {
    if (!VALID_LEVELS.includes(level)) {
      throw new Error(`Invalid log level "${level}". Must be one of: ${VALID_LEVELS.join(', ')}`);
    }
    this.#level = LEVELS[level];
  }

  /** @param {string} message @param {object} [data] */
  debug(message, data) { this.#emit('debug', message, data); }

  /** @param {string} message @param {object} [data] */
  info(message, data) { this.#emit('info', message, data); }

  /** @param {string} message @param {object} [data] */
  warning(message, data) { this.#emit('warning', message, data); }

  /** @param {string} message @param {object} [data] */
  error(message, data) { this.#emit('error', message, data); }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  #parseLevel(level) {
    if (!VALID_LEVELS.includes(level)) {
      // Fall back to info for bad initial values rather than throwing
      return LEVELS.info;
    }
    return LEVELS[level];
  }

  /**
   * Emit a `notifications/message` MCP notification if the message's level
   * is at or above the active threshold.
   */
  #emit(level, message, data = undefined) {
    if (LEVELS[level] < this.#level) return;

    const params = {
      level,
      logger: 'mcp-librarian',
      data: data !== undefined ? { message, ...data } : { message },
    };

    this.#transport.send({
      jsonrpc: '2.0',
      method: 'notifications/message',
      params,
    });
  }
}
