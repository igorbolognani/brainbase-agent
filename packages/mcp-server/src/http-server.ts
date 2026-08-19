#!/usr/bin/env node
/**
 * GPTRouter MCP HTTP Server (LOCAL DEVELOPMENT MODE)
 *
 * Streamable HTTP `/mcp` endpoint using MCP TypeScript SDK v2
 *
 * CURRENT STATE: Local development mode with localhost-only binding and
 * DNS rebinding protection. NOT configured for public deployment.
 *
 * TODO: Implement deployment mode with explicit trusted host/origin policy,
 * proper authentication/authorization boundary, and secure public binding.
 * See Phase 0B requirements.
 */

import { createServer } from 'node:http';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import {
  toNodeHandler,
  localhostHostValidation,
  localhostOriginValidation,
} from '@modelcontextprotocol/node';

// Import shared tool logic
import { ListModelsInput, RouteTaskInput, GetTaskInput, GetUsageInput } from './schemas.js';
import {
  listModelsHandler,
  routeTaskHandler,
  getTaskHandler,
  getUsageHandler,
} from './handlers.js';

// ============================================================================
// MCP Handler Factory (per-request instance)
// ============================================================================

const handler = createMcpHandler(() => {
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
});

// ============================================================================
// HTTP Server with DNS Rebinding Protection
// ============================================================================

const nodeHandler = toNodeHandler(handler);
const validateHost = localhostHostValidation();
const validateOrigin = localhostOriginValidation();

const server = createServer((req, res) => {
  // Protect against DNS rebinding attacks
  if (!validateHost(req, res) || !validateOrigin(req, res)) return;
  void nodeHandler(req, res);
});

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const HOST = process.env.HOST || '127.0.0.1';

server.listen(PORT, HOST, () => {
  console.error(`GPTRouter MCP HTTP Server (LOCAL DEV) listening on http://${HOST}:${PORT}/mcp`);
  console.error('MODE: Local development only (localhost binding + DNS rebinding protection)');
  console.error('V0.1: Exposes safe, read-only routing tools');
  console.error('Available tools: list_models, route_task, get_task, get_usage');
  console.error('NOT CONFIGURED FOR PUBLIC DEPLOYMENT - see Phase 0B requirements');
});

// Graceful shutdown
process.on('SIGINT', () => {
  void (async () => {
    console.error('Shutting down...');
    await handler.close();
    server.close(() => {
      console.error('Server closed');
      process.exit(0);
    });
  })();
});

process.on('SIGTERM', () => {
  void (async () => {
    console.error('Shutting down...');
    await handler.close();
    server.close(() => {
      console.error('Server closed');
      process.exit(0);
    });
  })();
});
