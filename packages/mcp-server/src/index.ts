#!/usr/bin/env node
/** GPTRouter MCP Server (v2) - stdio local-development entry point. */
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { createGPTRouterMcpServer } from './mcp-server-factory.js';

async function main(): Promise<void> {
  const server = createGPTRouterMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('GPTRouter MCP Server started (v2, stdio local development)');
  console.error('Available tools: list_models, route_task, get_task, get_usage');
}

main().catch((error: unknown) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
