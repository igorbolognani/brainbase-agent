import { createServer, type Server } from 'node:http';
import { createMcpHandler } from '@modelcontextprotocol/server';
import {
  toNodeHandler,
  localhostHostValidation,
  localhostOriginValidation,
} from '@modelcontextprotocol/node';
import { createGPTRouterMcpServer } from './mcp-server-factory.js';
import {
  applyRemoteRequestBoundary,
  type HttpServerConfig,
} from './http-config.js';

export interface GPTRouterHttpRuntime {
  server: Server;
  close(): Promise<void>;
}

/**
 * Create the Node HTTP adapter without binding a port.
 *
 * Tests can bind to port 0 and exercise the real Streamable HTTP path while
 * production startup remains a tiny CLI wrapper.
 */
export function createGPTRouterHttpRuntime(config: HttpServerConfig): GPTRouterHttpRuntime {
  const handler = createMcpHandler(() => createGPTRouterMcpServer());
  const nodeHandler = toNodeHandler(handler);
  const validateLocalHost = localhostHostValidation();
  const validateLocalOrigin = localhostOriginValidation();

  const server = createServer((req, res) => {
    // Resolve the request-target against a fixed base. Host is validated
    // independently before any MCP dispatch in remote mode.
    const url = new URL(req.url ?? '/', 'http://localhost');

    if (url.pathname === '/healthz') {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ status: 'ok', mode: config.mode }));
      return;
    }

    if (url.pathname !== '/mcp') {
      res.statusCode = 404;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'not_found' }));
      return;
    }

    if (config.mode === 'local') {
      if (!validateLocalHost(req, res) || !validateLocalOrigin(req, res)) return;
    } else if (!applyRemoteRequestBoundary(req, res, config)) {
      return;
    }

    void nodeHandler(req, res);
  });

  return {
    server,
    async close(): Promise<void> {
      await handler.close();
      await new Promise<void>((resolve, reject) => {
        if (!server.listening) {
          resolve();
          return;
        }
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}
