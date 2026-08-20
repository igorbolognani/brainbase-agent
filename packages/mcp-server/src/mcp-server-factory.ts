import { McpServer } from '@modelcontextprotocol/server';
import {
  GetTaskInput,
  GetUsageInput,
  GetAuditEventsInput,
  CancelExecutionInput,
  ListModelsInput,
  RouteTaskInput,
  RunTaskInput,
} from './schemas.js';
import { authorizedContext, createGPTRouterHandlers } from './handlers.js';
import { createSyntheticGPTRouterApplication, type GPTRouterApplication } from './application.js';
import { registerGPTRouterDashboardUi } from './plugin-ui.js';

export interface GPTRouterMcpServerOptions {
  /** Runtime-scoped authoritative application state. */
  application?: GPTRouterApplication;
  /** Require verified account context for every account-scoped read/planning tool. */
  requireAuthenticatedAccount?: boolean;
  /** Require verified account context for the consequential run_task tool. */
  requireAuthenticatedExecution?: boolean;
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
  const handlers = createGPTRouterHandlers(application, {
    requireAuthenticatedAccount: options.requireAuthenticatedAccount,
    requireAuthenticatedExecution: options.requireAuthenticatedExecution,
  });
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
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args, context) => handlers.listModelsHandler(args, context)
  );

  server.registerTool(
    'route_task',
    {
      description:
        'Plan the best route for a task using the real RoutingEngine and repository-backed synthetic state. DOES NOT execute or spend money.',
      inputSchema: RouteTaskInput,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args, context) => handlers.routeTaskHandler(args, context)
  );

  server.registerTool(
    'get_task',
    {
      description:
        'Retrieve a repository-backed planned task and its latest routing decision. No execution is performed.',
      inputSchema: GetTaskInput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args, context) => handlers.getTaskHandler(args, context)
  );

  server.registerTool(
    'get_usage',
    {
      description:
        'Get synthetic session planning estimates separately from actual provider spend, which remains zero.',
      inputSchema: GetUsageInput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args, context) => handlers.getUsageHandler(args, context)
  );

  server.registerTool(
    'run_task',
    {
      title: 'Run task',
      description:
        'Explicitly approve and execute one planned task through the deterministic synthetic executor. This is consequential, but performs no provider or paid call.',
      inputSchema: RunTaskInput,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args, context) => handlers.runTaskHandler(args, context)
  );

  server.registerTool(
    'cancel_execution',
    {
      title: 'Cancel execution',
      description:
        'Request cancellation of one synthetic execution attempt. Cancellation is idempotent and never invokes a provider.',
      inputSchema: CancelExecutionInput,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args, context) => handlers.cancelExecutionHandler(args, context)
  );

  server.registerTool(
    'get_audit_events',
    {
      title: 'Get audit events',
      description:
        'Retrieve account-scoped activity and audit events with sanitized metadata. Bounded results, no secret-bearing fields.',
      inputSchema: GetAuditEventsInput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args, context) => handlers.getAuditEventsHandler(args, context)
  );

  registerGPTRouterDashboardUi(server, {
    getRuntimeSummary: async (context) => {
      const account = await authorizedContext(
        application,
        context,
        options.requireAuthenticatedAccount ?? false,
        'viewer'
      );
      return application.getDashboardSummary(account);
    },
  });

  return server;
}
