import { createServer, type Server } from 'node:http';
import { createMcpHandler } from '@modelcontextprotocol/server';
import {
  toNodeHandler,
  localhostHostValidation,
  localhostOriginValidation,
} from '@modelcontextprotocol/node';
import { createGPTRouterMcpServer } from './mcp-server-factory.js';
import {
  applyRemoteNetworkBoundary,
  applyRemoteRequestBoundary,
  type HttpServerConfig,
} from './http-config.js';
import {
  createOAuthProtectedMcpHandler,
  type OAuthResourceServerOptions,
} from './oauth-resource-server.js';

export interface GPTRouterHttpRuntime {
  server: Server;
  close(): Promise<void>;
}

export interface GPTRouterHttpRuntimeOptions {
  /**
   * When present in remote mode, use standards-based OAuth resource-server
   * authentication. When absent, retain the Phase 0B static bearer bootstrap
   * boundary for deployment bring-up only.
   */
  oauth?: OAuthResourceServerOptions;
}

/**
 * Create the Node HTTP adapter without binding a port.
 *
 * Tests can bind to port 0 and exercise the real Streamable HTTP path while
 * production startup remains a tiny CLI wrapper.
 */
export function createGPTRouterHttpRuntime(
  config: HttpServerConfig,
  options: GPTRouterHttpRuntimeOptions = {}
): GPTRouterHttpRuntime {
  if (options.oauth && config.mode !== 'remote') {
    throw new Error('OAuth resource-server mode is only valid for remote HTTP mode');
  }

  const handler = createMcpHandler(() => createGPTRouterMcpServer());
  const servedHandler = options.oauth
    ? createOAuthProtectedMcpHandler(handler, options.oauth)
    : handler;
  const nodeHandler = toNodeHandler(servedHandler);
  const validateLocalHost = localhostHostValidation();
  const validateLocalOrigin = localhostOriginValidation();

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');

    if (url.pathname === '/healthz') {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(
        JSON.stringify({
          status: 'ok',
          mode: config.mode,
          authentication: options.oauth ? 'oauth_resource_server' : 'bootstrap_bearer',
        })
      );
      return;
    }

    const isOAuthDiscovery = Boolean(options.oauth) && url.pathname.startsWith('/.well-known/');
    if (url.pathname !== '/mcp' && !isOAuthDiscovery) {
      res.statusCode = 404;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'not_found' }));
      return;
    }

    if (config.mode === 'local') {
      if (!validateLocalHost(req, res) || !validateLocalOrigin(req, res)) return;
    } else if (options.oauth) {
      if (!applyRemoteNetworkBoundary(req, res, config)) return;
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
