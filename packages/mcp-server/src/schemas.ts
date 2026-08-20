/**
 * MCP Tool Input Schemas
 */

import * as z from 'zod/v4';

export const ListModelsInput = z.object({
  capability_filter: z
    .array(z.string())
    .optional()
    .describe('Optional: Filter models by required capabilities (e.g., ["text", "vision"])'),
  provider_filter: z.string().optional().describe('Optional: Filter by provider ID'),
});

export const RouteTaskInput = z.object({
  description: z.string().describe('Human-readable task description'),
  required_capabilities: z
    .array(z.string())
    .describe('Required capabilities (e.g., ["text"], ["vision", "audio"])'),
  ordering_strategy: z
    .enum(['cost'])
    .describe('Routing strategy (V0.1: only "cost" is operational)'),
});

export const GetTaskInput = z.object({
  task_id: z.string().describe('Task ID from route_task response'),
});

export const GetUsageInput = z.object({
  time_range: z.enum(['today', 'week', 'month']).optional().describe('Time range for usage data'),
});

export const RunTaskInput = z.object({
  task_id: z.string().min(1).describe('Task ID from route_task response'),
  decision_id: z.string().min(1).describe('Routing decision ID approved for execution'),
  idempotency_key: z.string().min(1).max(200).describe('Stable key preventing duplicate dispatch'),
});

export const CancelExecutionInput = z.object({
  attempt_id: z.string().min(1).describe('Execution attempt ID from run_task or get_task'),
});

export const GetAuditEventsInput = z.object({
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe('Maximum events to return (default 50)'),
  offset: z.number().int().min(0).optional().describe('Pagination offset (default 0)'),
  event_type: z.string().optional().describe('Filter by event type'),
});

export type ListModelsArgs = z.infer<typeof ListModelsInput>;
export type RouteTaskArgs = z.infer<typeof RouteTaskInput>;
export type GetTaskArgs = z.infer<typeof GetTaskInput>;
export type GetUsageArgs = z.infer<typeof GetUsageInput>;
export type RunTaskArgs = z.infer<typeof RunTaskInput>;
export type CancelExecutionArgs = z.infer<typeof CancelExecutionInput>;
export type GetAuditEventsArgs = z.infer<typeof GetAuditEventsInput>;
