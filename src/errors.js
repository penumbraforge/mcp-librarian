export const ERROR_CODES = {
  SERVER_ERROR:        -32000,
  SKILL_NOT_FOUND:     -32001,
  INVALID_INPUT:       -32002,
  RATE_LIMITED:        -32003,
  CONTENT_GUARD:       -32004,
  INTEGRITY_FAILED:    -32005,
  PACK_NOT_FOUND:      -32006,
  PACK_FETCH_FAILED:   -32007,
  VALIDATION_FAILED:   -32008,
  CONFIG_ERROR:        -32009,
  PATH_VIOLATION:      -32010,
};

export class McpError extends Error {
  constructor(code, message, context = {}) {
    super(message);
    this.code = code;
    this.context = context;
    this.name = 'McpError';
  }

  toJsonRpc(id) {
    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: this.code,
        message: this.message,
        data: this.context,
      },
    };
  }
}
