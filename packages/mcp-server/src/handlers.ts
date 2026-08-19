/**
 * MCP Tool Handlers
 * V0.1: Mock implementations with synthetic fixture data
 */

import type { ListModelsArgs, RouteTaskArgs, GetTaskArgs, GetUsageArgs } from './schemas.js';

export async function listModelsHandler(args: ListModelsArgs) {
  // V0.1: Return synthetic fixture data
  // Real implementation would query model catalog with account scope
  const models = [
    {
      route_id: 'route-gpt4-mini',
      source_id: 'gpt-4-mini',
      route_type: 'provider',
      source_provider: 'openai',
      capabilities: ['text', 'function-calling'],
      pricing: {
        input_cost_per_1k_tokens: 0.00015,
        output_cost_per_1k_tokens: 0.0006,
        currency: 'USD',
        units: 'per_1k_tokens',
      },
      availability_status: 'available',
    },
    {
      route_id: 'route-claude-haiku',
      source_id: 'claude-3-haiku',
      route_type: 'provider',
      source_provider: 'anthropic',
      capabilities: ['text', 'function-calling'],
      pricing: {
        input_cost_per_1k_tokens: 0.00025,
        output_cost_per_1k_tokens: 0.00125,
        currency: 'USD',
        units: 'per_1k_tokens',
      },
      availability_status: 'available',
    },
  ];

  // Apply filters if provided
  let filtered = models;
  if (args.capability_filter) {
    filtered = filtered.filter((m) =>
      args.capability_filter!.every((cap) => m.capabilities.includes(cap))
    );
  }
  if (args.provider_filter) {
    filtered = filtered.filter((m) => m.source_provider === args.provider_filter);
  }

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ models: filtered }, null, 2),
      },
    ],
  };
}

export async function routeTaskHandler(args: RouteTaskArgs) {
  // V0.1: Return mock routing decision
  // Real implementation would use RoutingEngine with account context
  const taskId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const decision = {
    decision_id: `decision_${Math.random().toString(36).slice(2, 11)}`,
    task_id: taskId,
    status: 'planning',
    description: args.description,
    required_capabilities: args.required_capabilities,
    selected_route: {
      route_id: 'route-gpt4-mini',
      source_id: 'gpt-4-mini',
      route_type: 'provider',
      source_provider: 'openai',
    },
    estimated_cost: 0.0002,
    ordering_strategy: args.ordering_strategy,
    decided_at: new Date().toISOString(),
    note: 'V0.1: This is a planning decision only. No execution or spending occurs.',
  };

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(decision, null, 2),
      },
    ],
  };
}

export async function getTaskHandler(args: GetTaskArgs) {
  // V0.1: Return mock task status
  const task = {
    task_id: args.task_id,
    status: 'planning',
    description: 'Mock task',
    created_at: new Date().toISOString(),
    note: 'V0.1: Task execution not yet implemented. Tasks remain in planning status.',
  };

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(task, null, 2),
      },
    ],
  };
}

export async function getUsageHandler(args: GetUsageArgs) {
  // V0.1: Return mock usage data
  const usage = {
    time_range: args.time_range || 'today',
    total_requests: 0,
    total_cost: 0.0,
    cost_breakdown: {},
    note: 'V0.1: Usage tracking not yet implemented. Returns zero usage.',
  };

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(usage, null, 2),
      },
    ],
  };
}
