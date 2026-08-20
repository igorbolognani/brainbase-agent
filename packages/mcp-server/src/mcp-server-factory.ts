import { McpServer } from '@modelcontextprotocol/server';
import { ListModelsInput, RouteTaskInput, GetTaskInput, GetUsageInput } from './schemas.js';
import { createGPTRouterHandlers } from './handlers.js';
import { createSyntheticGPTRouterApplication, type GPTRouterApplication } from './application.js';
import { registerGPTRouterDashboardUi } from './plugin-ui.js';

export interface GPTRouterMcpServerOptions {
  /** Runtime-scoped authoritative application state. */
  application?: GPTRouterApplication;
}

/**
 * Build one GPTRouter MCP protocol server around an injected application.
 *
 * Transport adapters can create multiple MCP server instances while sharing one
 * runtime-scoped application state. This keeps HTTP task planning/retrieval
 * coherent without making the MCP server object itself the authoritative store.
 */
export function createGPTRouterMcpServer(options: GPTRouterMcpServerOptions = {}): McpServer {
  const application = options.application ?? createSyntheticGPTRouterApplication();
  const handlers = createGPTRouterHandlers(application);
  const server = new McpServer({
    name: 'gptrouter-mcp',
    version: '0.1.0',
  });

  server.registerTool(
    'list_models',
    {
      description:
        'List repository-backed synthetic model routes with safe pricing/provenance projections. Read-only and no-spend.',
      inputSchema: ListModelsInput,
    },
    async (args) => handlers.listModelsHandler(args)
  );

  server.registerTool(
    'route_task',
    {
      description:
        'Plan the best route for a task using the real RoutingEngine and repository-backed synthetic state. DOES NOT execute or spend money.',
      inputSchema: RouteTaskInput,
    },
    async (args) => handlers.routeTaskHandler(args)
  );

  server.registerTool(
    'get_task',
    {
      description:
        'Retrieve a repository-backed planned task and its latest routing decision. No execution is performed.',
      inputSchema: GetTaskInput,
    },
    async (args) => handlers.getTaskHandler(args)
  );

  server.registerTool(
    'get_usage',
    {
      description:
        'Get synthetic session planning estimates separately from actual provider spend, which remains zero.',
      inputSchema: GetUsageInput,
    },
    async (args) => handlers.getUsageHandler(args)
  );

  registerGPTRouterDashboardUi(server, {
    getRuntimeSummary: () => application.getDashboardSummary(),
  });

  return server;
}
