#!/usr/bin/env node
/**
 * GPTRouter MCP HTTP Server
 *
 * Streamable HTTP `/mcp` endpoint using MCP TypeScript SDK v2.
 *
 * Modes:
 * - local (default): loopback bind + SDK localhost Host/Origin guards
 * - remote: explicit bind + Host/Origin allow-lists + bearer boundary
 *
 * Remote mode is intentionally fail-closed and will not start unless every
 * required security setting is present. The bearer gate is a deployment
 * bootstrap boundary; Phase 0E will replace/extend it with runtime identity,
 * tenant authorization, and production token verification.
 */

import { createServer } from 'node:http';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import {
  toNodeHandler,
  localhostHostValidation,
  localhostOriginValidation,
} from '@modelcontextprotocol/node';

import { ListModelsInput, RouteTaskInput, GetTaskInput, GetUsageInput } from './schemas.js';
import {
  listModelsHandler,
  routeTaskHandler,
  getTaskHandler,
  getUsageHandler,
} from './handlers.js';
import { applyRemoteRequestBoundary, loadHttpServerConfig } from './http-config.js';

function createGPTRouterMcpServer(): McpServer {
  const server = new McpServer({
    name: 'gptrouter-mcp',
    version: '0.1.0',
  });

  server.registerTool(
    'list_models',
    {
      description:
        'List available AI models and routes. Returns models with capabilities, pricing, and availability. Read-only, no API calls made.',
      inputSchema: ListModelsInput,
    },
    listModelsHandler
  );

  server.registerTool(
    'route_task',
    {
      description:
        'Plan the best route for a task based on requirements and policy. DOES NOT execute or spend money. Returns routing decision with estimated cost and selected route.',
      inputSchema: RouteTaskInput,
    },
    routeTaskHandler
  );

  server.registerTool(
    'get_task',
    {
      description:
        'Retrieve task status and routing decision. Returns task details, selected route, and execution status if applicable.',
      inputSchema: GetTaskInput,
    },
    getTaskHandler
  );

  server.registerTool(
    'get_usage',
    {
      description:
        'Get usage summary and cost breakdown. Returns aggregate usage statistics and cost information. Read-only.',
      inputSchema: GetUsageInput,
    },
    getUsageHandler
  );

  return server;
}

const config = loadHttpServerConfig();
const handler = createMcpHandler(() => createGPTRouterMcpServer());
const nodeHandler = toNodeHandler(handler);

const validateLocalHost = localhostHostValidation();
const validateLocalOrigin = localhostOriginValidation();

const server = createServer((req, res) => {
  // Parse only the request target against a fixed base. Never trust Host while
  // deciding whether the Host header itself is admissible.
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

server.listen(config.port, config.host, () => {
  console.error(
    `GPTRouter MCP HTTP Server listening on http://${config.host}:${config.port}/mcp (${config.mode})`
  );
  if (config.mode === 'local') {
    console.error('Security: loopback-only bind + localhost Host/Origin validation');
  } else {
    console.error('Security: explicit Host/Origin allow-lists + bearer boundary');
  }
  console.error('Available tools: list_models, route_task, get_task, get_usage');
  console.error('route_task remains planning-only: no provider execution or spend');
});

async function shutdown(): Promise<void> {
  console.error('Shutting down...');
  await handler.close();
  server.close(() => {
    console.error('Server closed');
    process.exit(0);
  });
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
