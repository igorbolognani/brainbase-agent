#!/usr/bin/env node
/**
 * GPTRouter MCP HTTP Server
 *
 * Streamable HTTP `/mcp` endpoint using MCP TypeScript SDK v2.
 * Local mode is loopback-only. Remote mode is explicit and fail-closed.
 */

import { loadHttpServerConfig } from './http-config.js';
import { createGPTRouterHttpRuntime } from './http-app.js';

const config = loadHttpServerConfig();
const runtime = createGPTRouterHttpRuntime(config);

runtime.server.listen(config.port, config.host, () => {
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
  await runtime.close();
  console.error('Server closed');
  process.exit(0);
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
