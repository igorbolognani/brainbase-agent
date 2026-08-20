/**
 * MCP tool handlers.
 *
 * Phase 0G routes all reads/planning through one injected application state so
 * list_models, route_task, get_task, get_usage, and the UI can agree on the
 * same repository-backed synthetic truth.
 */

import type { AuthInfo } from '@modelcontextprotocol/server';
import { AuthorizationError } from '@gptrouter/security';
import type {
  GetTaskArgs,
  GetUsageArgs,
  GetAuditEventsArgs,
  ListModelsArgs,
  RouteTaskArgs,
  RunTaskArgs,
  CancelExecutionArgs,
} from './schemas.js';
import {
  createSyntheticGPTRouterApplication,
  type GPTRouterApplication,
  type VerifiedExecutionIdentity,
} from './application.js';

export interface GPTRouterHandlerOptions {
  requireAuthenticatedExecution?: boolean;
  requireAuthenticatedAccount?: boolean;
}

export interface McpToolContext {
  http?: {
    authInfo?: AuthInfo;
  };
}

function toolResult<T extends object>(value: T) {
  return {
    structuredContent: value as Record<string, unknown>,
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

function verifiedIdentity(authInfo: AuthInfo): VerifiedExecutionIdentity {
  const extra = authInfo.extra;
  const issuer = extra && typeof extra.issuer === 'string' ? extra.issuer : null;
  const subject = extra && typeof extra.subject === 'string' ? extra.subject : null;
  const account_id = extra && typeof extra.account_id === 'string' ? extra.account_id : null;
  if (!issuer || !subject || !account_id) throw new AuthorizationError();
  return { issuer, subject, account_id };
}

export async function authorizedContext(
  application: GPTRouterApplication,
  context: McpToolContext | undefined,
  required: boolean,
  minimumRole: 'viewer' | 'member'
) {
  if (!required) return application.getSyntheticAuthorizedContext();
  const authInfo = context?.http?.authInfo;
  if (!authInfo) throw new AuthorizationError();
  return application.authorizeVerifiedIdentity(verifiedIdentity(authInfo), minimumRole);
}

export function createGPTRouterHandlers(
  application: GPTRouterApplication,
  options: GPTRouterHandlerOptions = {}
) {
  const requireAccount = options.requireAuthenticatedAccount ?? false;
  return {
    async listModelsHandler(args: ListModelsArgs, context?: McpToolContext) {
      const account = await authorizedContext(application, context, requireAccount, 'viewer');
      const models = await application.listRoutes(
        {
          capability_filter: args.capability_filter,
          provider_filter: args.provider_filter,
        },
        account
      );
      return toolResult({
        data_mode: 'synthetic_repository',
        account_id: account.account.account_id,
        models,
      });
    },

    async routeTaskHandler(args: RouteTaskArgs, context?: McpToolContext) {
      const account = await authorizedContext(application, context, requireAccount, 'viewer');
      const planned = await application.planTask(
        {
          description: args.description,
          required_capabilities: args.required_capabilities,
          ordering_strategy: args.ordering_strategy,
        },
        account
      );
      return toolResult(planned);
    },

    async getTaskHandler(args: GetTaskArgs, context?: McpToolContext) {
      const account = await authorizedContext(application, context, requireAccount, 'viewer');
      const task = await application.getTask(args.task_id, account);
      return toolResult(
        task ?? {
          error: 'task_not_found',
          task_id: args.task_id,
          data_mode: 'synthetic_repository',
        }
      );
    },

    async getUsageHandler(args: GetUsageArgs, context?: McpToolContext) {
      const account = await authorizedContext(application, context, requireAccount, 'viewer');
      return toolResult(await application.getUsage(args.time_range, account));
    },

    async runTaskHandler(args: RunTaskArgs, context?: McpToolContext) {
      const requireExecutionAuth =
        options.requireAuthenticatedExecution ?? options.requireAuthenticatedAccount ?? false;
      const account = await authorizedContext(application, context, requireExecutionAuth, 'member');
      return toolResult(
        await application.runTask(
          {
            task_id: args.task_id,
            decision_id: args.decision_id,
            idempotency_key: args.idempotency_key,
          },
          account
        )
      );
    },

    async cancelExecutionHandler(args: CancelExecutionArgs, context?: McpToolContext) {
      const requireExecutionAuth =
        options.requireAuthenticatedExecution ?? options.requireAuthenticatedAccount ?? false;
      const account = await authorizedContext(application, context, requireExecutionAuth, 'member');
      return toolResult(await application.cancelExecution(args.attempt_id, account));
    },

    async getAuditEventsHandler(args: GetAuditEventsArgs, context?: McpToolContext) {
      const requireAccount = options.requireAuthenticatedAccount ?? false;
      const account = await authorizedContext(application, context, requireAccount, 'viewer');
      return toolResult(
        await application.getAuditEvents(account, args.limit, args.offset, args.event_type)
      );
    },
  };
}

// Backward-compatible direct exports for focused unit tests and simple local use.
// Production transport factories inject their own runtime-scoped application.
const defaultHandlers = createGPTRouterHandlers(createSyntheticGPTRouterApplication());

export const listModelsHandler = (args: ListModelsArgs) => defaultHandlers.listModelsHandler(args);
export const routeTaskHandler = (args: RouteTaskArgs) => defaultHandlers.routeTaskHandler(args);
export const getTaskHandler = (args: GetTaskArgs) => defaultHandlers.getTaskHandler(args);
export const getUsageHandler = (args: GetUsageArgs) => defaultHandlers.getUsageHandler(args);
export const runTaskHandler = (args: RunTaskArgs) => defaultHandlers.runTaskHandler(args);
export const cancelExecutionHandler = (args: CancelExecutionArgs) =>
  defaultHandlers.cancelExecutionHandler(args);
export const getAuditEventsHandler = (args: GetAuditEventsArgs) =>
  defaultHandlers.getAuditEventsHandler(args);
