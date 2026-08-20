import { McpServer } from '@modelcontextprotocol/server';
import { ListModelsInput, RouteTaskInput, GetTaskInput, GetUsageInput } from './schemas.js';
import {
  listModelsHandler,
  routeTaskHandler,
  getTaskHandler,
  getUsageHandler,
} from './handlers.js';
import { registerGPTRouterDashboardUi } from './plugin-ui.js';

/**
 * Build one stateless GPTRouter MCP server instance.
 *
 * Both stdio and HTTP transports use this factory so tool/resource registration
 * cannot drift between local development and remote deployment adapters.
 */
export function createGPTRouterMcpServer(): McpServer {
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

  registerGPTRouterDashboardUi(server);

  return server;
}
