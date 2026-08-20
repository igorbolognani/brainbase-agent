import { createServer, type Server } from 'node:http';
import { createMcpHandler } from '@modelcontextprotocol/server';
import {
  toNodeHandler,
  localhostHostValidation,
  localhostOriginValidation,
} from '@modelcontextprotocol/node';
import { createGPTRouterMcpServer } from './mcp-server-factory.js';
import { createSyntheticGPTRouterApplication, type GPTRouterApplication } from './application.js';
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
  application: GPTRouterApplication;
  close(): Promise<void>;
}

export interface GPTRouterHttpRuntimeOptions {
  /**
   * When present in remote mode, use standards-based OAuth resource-server
   * authentication. When absent, retain the Phase 0B static bearer bootstrap
   * boundary for deployment bring-up only.
   */
  oauth?: OAuthResourceServerOptions;
  /**
   * Runtime-scoped authoritative application state. Tests may inject a fresh
   * instance; production adapters can later inject durable repositories.
   */
  application?: GPTRouterApplication;
}

/**
 * Create the Node HTTP adapter without binding a port.
 *
 * The application is created once per HTTP runtime and injected into every MCP
 * protocol-server instance created by the Streamable HTTP handler. This makes
 * route_task → get_task persistence real across separate HTTP requests without
 * coupling persistence to one MCP transport object.
 */
export function createGPTRouterHttpRuntime(
  config: HttpServerConfig,
  options: GPTRouterHttpRuntimeOptions = {}
): GPTRouterHttpRuntime {
  if (options.oauth && config.mode !== 'remote') {
    throw new Error('OAuth resource-server mode is only valid for remote HTTP mode');
  }

  const application =
    options.application ??
    createSyntheticGPTRouterApplication({ requireAuthorizedExecution: config.mode === 'remote' });
  const handler = createMcpHandler(() =>
    createGPTRouterMcpServer({
      application,
      requireAuthenticatedAccount: Boolean(options.oauth),
      requireAuthenticatedExecution: config.mode === 'remote',
    })
  );
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
          data_mode: 'synthetic_repository',
          synthetic_execution_enabled: true,
          provider_execution: 'disabled',
          paid_calls_enabled: false,
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
    application,
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
