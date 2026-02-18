/**
 * MCP JSON-RPC protocol dispatcher.
 * Routes MCP methods to tool handlers.
 */

const MCP_VERSION = '2024-11-05';

export class Protocol {
  constructor(store, auditLog) {
    this.store = store;
    this.auditLog = auditLog;
    this.tools = new Map();
  }

  registerTool(name, handler, opts = {}) {
    this.tools.set(name, { handler, ...opts });
  }

  async dispatch(conn, msg, rateLimiter) {
    const { method, id, params } = msg;

    // MCP lifecycle methods
    if (method === 'initialize') {
      return this._respond(id, {
        protocolVersion: MCP_VERSION,
        serverInfo: { name: 'mcp-forge', version: '1.0.0' },
        capabilities: { tools: {} },
      });
    }

    if (method === 'initialized') {
      return null; // Notification, no response needed
    }

    if (method === 'ping') {
      return this._respond(id, {});
    }

    if (method === 'tools/list') {
      const toolList = [];
      for (const [name, tool] of this.tools) {
        // Filter by role
        if (tool.role === 'librarian' && !conn.isLibrarian) continue;
        toolList.push({
          name,
          description: tool.description || '',
          inputSchema: tool.inputSchema || { type: 'object', properties: {} },
        });
      }
      return this._respond(id, { tools: toolList });
    }

    if (method === 'tools/call') {
      const toolName = params?.name;
      const toolArgs = params?.arguments || {};

      // Rate limit
      const rl = rateLimiter.check(conn.id);
      if (!rl.allowed) {
        return this._error(id, -32000, `Rate limited. Retry after ${rl.retryAfterMs}ms`);
      }

      const tool = this.tools.get(toolName);
      if (!tool) {
        return this._error(id, -32601, `Unknown tool: ${toolName}`);
      }

      // Check role
      if (tool.role === 'librarian' && !conn.isLibrarian) {
        this.auditLog?.log({
          event: 'unauthorized',
          connId: conn.id,
          role: conn.role,
          tool: toolName,
        });
        return this._error(id, -32600, 'Insufficient permissions');
      }

      const start = performance.now();
      try {
        const result = await tool.handler(toolArgs, conn);
        const latency = Math.round(performance.now() - start);
        this.auditLog?.log({
          event: 'tool_call',
          connId: conn.id,
          role: conn.role,
          tool: toolName,
          latency,
        });
        return this._respond(id, {
          content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }],
        });
      } catch (e) {
        const latency = Math.round(performance.now() - start);
        this.auditLog?.log({
          event: 'tool_error',
          connId: conn.id,
          role: conn.role,
          tool: toolName,
          error: e.message,
          latency,
        });
        return this._error(id, -32000, e.message);
      }
    }

    return this._error(id, -32601, `Unknown method: ${method}`);
  }

  _respond(id, result) {
    return { jsonrpc: '2.0', id, result };
  }

  _error(id, code, message) {
    return { jsonrpc: '2.0', id, error: { code, message } };
  }
}
