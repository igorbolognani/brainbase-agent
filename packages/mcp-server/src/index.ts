#!/usr/bin/env node
/** GPTRouter MCP Server (v2) - stdio local-development entry point. */
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { createGPTRouterMcpServer } from './mcp-server-factory.js';
import { createSyntheticGPTRouterApplication } from './application.js';

async function main(): Promise<void> {
  const application = createSyntheticGPTRouterApplication();
  const server = createGPTRouterMcpServer({ application });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('GPTRouter MCP Server started (v2, stdio local development)');
  console.error('Data mode: repository-backed synthetic / provider execution disabled');
  console.error(
    'Available tools: list_models, route_task, get_task, get_usage, render_gptrouter_dashboard'
  );
}

main().catch((error: unknown) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
