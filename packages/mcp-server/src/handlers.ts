/**
 * MCP tool handlers.
 *
 * Phase 0G routes all reads/planning through one injected application state so
 * list_models, route_task, get_task, get_usage, and the UI can agree on the
 * same repository-backed synthetic truth.
 */

import type { ListModelsArgs, RouteTaskArgs, GetTaskArgs, GetUsageArgs } from './schemas.js';
import {
  createSyntheticGPTRouterApplication,
  type GPTRouterApplication,
} from './application.js';

function toolResult<T extends Record<string, unknown>>(value: T) {
  return {
    structuredContent: value,
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

export function createGPTRouterHandlers(application: GPTRouterApplication) {
  return {
    async listModelsHandler(args: ListModelsArgs) {
      const models = await application.listRoutes({
        capability_filter: args.capability_filter,
        provider_filter: args.provider_filter,
      });
      return toolResult({
        data_mode: 'synthetic_repository',
        account_id: application.account_id,
        models,
      });
    },

    async routeTaskHandler(args: RouteTaskArgs) {
      const planned = await application.planTask({
        description: args.description,
        required_capabilities: args.required_capabilities,
        ordering_strategy: args.ordering_strategy,
      });
      return toolResult(planned);
    },

    async getTaskHandler(args: GetTaskArgs) {
      const task = await application.getTask(args.task_id);
      return toolResult(
        task ?? {
          error: 'task_not_found',
          task_id: args.task_id,
          data_mode: 'synthetic_repository',
        }
      );
    },

    async getUsageHandler(args: GetUsageArgs) {
      return toolResult(await application.getUsage(args.time_range));
    },
  };
}

// Backward-compatible direct exports for focused unit tests and simple local use.
// Production transport factories inject their own runtime-scoped application.
const defaultHandlers = createGPTRouterHandlers(createSyntheticGPTRouterApplication());

export const listModelsHandler = defaultHandlers.listModelsHandler;
export const routeTaskHandler = defaultHandlers.routeTaskHandler;
export const getTaskHandler = defaultHandlers.getTaskHandler;
export const getUsageHandler = defaultHandlers.getUsageHandler;
