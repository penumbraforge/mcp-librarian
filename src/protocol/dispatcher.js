/**
 * Dispatcher — JSON-RPC 2.0 message router for the MCP protocol.
 *
 * Responsibilities:
 *  - Route incoming messages to the correct handler by method name.
 *  - Enforce the MCP lifecycle (initialize → initialized → running).
 *  - Apply a sliding-window rate limiter to all non-lifecycle requests.
 *  - Emit properly-formatted JSON-RPC success and error responses.
 *
 * JSON-RPC semantics:
 *  - Messages WITH an `id` are requests  → must send a response.
 *  - Messages WITHOUT an `id` are notifications → process silently, no response.
 */

import { McpLogger } from './logging.js';

// JSON-RPC 2.0 error codes
const PARSE_ERROR      = -32700;
const INVALID_REQUEST  = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS   = -32602;
const INTERNAL_ERROR   = -32603;
const RATE_LIMITED     = -32003;

// MCP protocol version advertised in `initialize` responses.
const PROTOCOL_VERSION = '2025-03-26';

// Methods exempt from rate limiting (lifecycle + heartbeat).
const RATE_LIMIT_EXEMPT = new Set(['initialize', 'initialized', 'ping']);

// Window size for the sliding rate limiter (milliseconds).
const RATE_WINDOW_MS = 60_000;

export class Dispatcher {
  #store;
  #config;
  #transport;
  #logger;

  // Sliding-window rate limiter: array of timestamps (ms) for recent requests.
  #requestTimestamps = [];

  // Pluggable handlers — wired in later tasks via setter methods.
  #toolDefs = [];
  #toolCallHandler = null;
  #resourceListFn = null;
  #resourceReadFn = null;
  #promptListFn = null;
  #promptGetFn = null;

  /**
   * @param {object} store      - skill store (wired later)
   * @param {object} config     - resolved config ({ rateLimit, logLevel, ... })
   * @param {object} transport  - must expose send(object)
   */
  constructor(store, config, transport) {
    this.#store = store;
    this.#config = config;
    this.#transport = transport;
    this.#logger = new McpLogger(transport, config.logLevel ?? 'info');
  }

  // ---------------------------------------------------------------------------
  // Setter methods — wired later by the entry point / integration layer
  // ---------------------------------------------------------------------------

  /**
   * Provide the tool definition list and the call dispatcher function.
   * @param {Array}    toolDefs        - array of MCP tool descriptors
   * @param {Function} toolCallHandler - async (name, params) => result
   */
  setToolHandlers(toolDefs, toolCallHandler) {
    this.#toolDefs = toolDefs;
    this.#toolCallHandler = toolCallHandler;
  }

  /**
   * @param {Function} listFn - async () => [resource, ...]
   * @param {Function} readFn - async (uri) => content
   */
  setResourceHandlers(listFn, readFn) {
    this.#resourceListFn = listFn;
    this.#resourceReadFn = readFn;
  }

  /**
   * @param {Function} listFn - async () => [prompt, ...]
   * @param {Function} getFn  - async (name, args) => messages
   */
  setPromptHandlers(listFn, getFn) {
    this.#promptListFn = listFn;
    this.#promptGetFn = getFn;
  }

  // ---------------------------------------------------------------------------
  // Core message handler
  // ---------------------------------------------------------------------------

  /**
   * Route a single JSON-RPC 2.0 message.
   * Notifications (no `id`) are handled silently.
   * Requests (have `id`) always receive a response — either `result` or `error`.
   *
   * @param {object} message - parsed JSON-RPC message
   */
  async handleMessage(message) {
    const id = message.id ?? null;
    const isRequest = id !== null && id !== undefined;

    // -------------------------------------------------------------------------
    // Basic structural validation — must have a method field.
    // -------------------------------------------------------------------------
    if (typeof message.method !== 'string' || message.method === '') {
      if (isRequest) {
        this.#sendError(id, INVALID_REQUEST, 'Invalid Request: missing or empty method field');
      }
      return;
    }

    const method = message.method;
    const params = message.params ?? {};

    // -------------------------------------------------------------------------
    // Handle notifications first — these never produce a response.
    // -------------------------------------------------------------------------
    if (!isRequest) {
      await this.#handleNotification(method, params);
      return;
    }

    // -------------------------------------------------------------------------
    // Apply rate limiting (exempt: initialize, ping).
    // -------------------------------------------------------------------------
    if (!RATE_LIMIT_EXEMPT.has(method)) {
      const limited = this.#checkRateLimit();
      if (limited !== null) {
        this.#sendError(id, RATE_LIMITED, limited);
        return;
      }
    }

    // -------------------------------------------------------------------------
    // Route request to handler.
    // -------------------------------------------------------------------------
    try {
      const result = await this.#routeRequest(method, params, id);
      // routeRequest returns undefined when it has already sent the response
      // (e.g. delegated error); otherwise send the result here.
      if (result !== undefined) {
        this.#sendResult(id, result);
      }
    } catch (err) {
      const code = err.code ?? INTERNAL_ERROR;
      const msg  = err.message ?? 'Internal error';
      const data = err.context ?? {};
      this.#sendError(id, code, msg, data);
    }
  }

  // ---------------------------------------------------------------------------
  // Request routing
  // ---------------------------------------------------------------------------

  async #routeRequest(method, params, id) {
    switch (method) {

      // MCP lifecycle
      case 'initialize':
        return this.#handleInitialize(params);

      case 'ping':
        return {};

      // Tools
      case 'tools/list':
        return { tools: this.#toolDefs };

      case 'tools/call': {
        const { name, arguments: args = {} } = params;
        if (!name) {
          this.#sendError(id, INVALID_PARAMS, 'tools/call requires params.name');
          return undefined;
        }
        if (this.#toolCallHandler) {
          const raw = await this.#toolCallHandler(name, args);
          // MCP spec: tools/call results must be wrapped in content blocks
          if (raw && raw.content && Array.isArray(raw.content)) {
            return raw; // Already in MCP format
          }
          return {
            content: [{ type: 'text', text: JSON.stringify(raw, null, 2) }],
          };
        }
        // Stub: not yet wired
        return { content: [{ type: 'text', text: `Tool "${name}" not yet wired` }] };
      }

      // Resources
      case 'resources/list': {
        if (this.#resourceListFn) {
          const list = await this.#resourceListFn();
          // Wrap in { resources } if the handler returned a plain array
          return Array.isArray(list) ? { resources: list } : list;
        }
        return { resources: [] };
      }

      case 'resources/read': {
        const { uri } = params;
        if (!uri) {
          this.#sendError(id, INVALID_PARAMS, 'resources/read requires params.uri');
          return undefined;
        }
        if (this.#resourceReadFn) return await this.#resourceReadFn(uri);
        return { contents: [] };
      }

      // Prompts
      case 'prompts/list': {
        if (this.#promptListFn) {
          const list = await this.#promptListFn();
          // Wrap in { prompts } if the handler returned a plain array
          return Array.isArray(list) ? { prompts: list } : list;
        }
        return { prompts: [] };
      }

      case 'prompts/get': {
        const { name, arguments: args = {} } = params;
        if (!name) {
          this.#sendError(id, INVALID_PARAMS, 'prompts/get requires params.name');
          return undefined;
        }
        if (this.#promptGetFn) return await this.#promptGetFn(name, args);
        return { messages: [] };
      }

      // Logging
      case 'logging/setLevel': {
        const { level } = params;
        try {
          this.#logger.setLevel(level);
        } catch (err) {
          this.#sendError(id, INVALID_PARAMS, err.message);
          return undefined;
        }
        return {};
      }

      default:
        this.#sendError(id, METHOD_NOT_FOUND, `Method not found: ${method}`);
        return undefined;
    }
  }

  // ---------------------------------------------------------------------------
  // Notification handling (no response ever)
  // ---------------------------------------------------------------------------

  async #handleNotification(method, params) {
    switch (method) {
      case 'initialized':
        // Client confirms it has received initialize response — no-op.
        break;

      case 'notifications/cancelled':
        // Future: cancel in-flight request. Silently ignored for now.
        break;

      default:
        // Unknown notifications are silently discarded per JSON-RPC spec.
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // initialize handler
  // ---------------------------------------------------------------------------

  #handleInitialize(_params) {
    return {
      protocolVersion: PROTOCOL_VERSION,
      serverInfo: { name: 'mcp-librarian', version: '3.0.0' },
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
        logging: {},
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Rate limiter — sliding window counter
  // ---------------------------------------------------------------------------

  /**
   * Check whether the current request exceeds the rate limit.
   * @returns {string|null} Error message string if limited, null if OK.
   */
  #checkRateLimit() {
    const now = Date.now();
    const windowMs = RATE_WINDOW_MS;
    const limit = this.#config.rateLimit ?? 200;

    // Drop timestamps outside the current window.
    this.#requestTimestamps = this.#requestTimestamps.filter(
      (ts) => now - ts < windowMs
    );

    if (this.#requestTimestamps.length >= limit) {
      // Calculate when the oldest request will fall out of the window.
      const oldest = this.#requestTimestamps[0];
      const resetAt = new Date(oldest + windowMs).toISOString();
      return `Rate limit exceeded (${limit} requests per ${windowMs / 1000}s). Resets at ${resetAt}.`;
    }

    // Record this request.
    this.#requestTimestamps.push(now);
    return null;
  }

  // ---------------------------------------------------------------------------
  // Response helpers
  // ---------------------------------------------------------------------------

  #sendResult(id, result) {
    this.#transport.send({ jsonrpc: '2.0', id, result });
  }

  #sendError(id, code, message, data = undefined) {
    const error = { code, message };
    if (data !== undefined && Object.keys(data).length > 0) {
      error.data = data;
    }
    this.#transport.send({ jsonrpc: '2.0', id, error });
  }
}
