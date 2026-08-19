#!/usr/bin/env node
/**
 * GPTRouter MCP Server
 *
 * Remote MCP server compatible with OpenAI ChatGPT Plugins
 * Exposes safe, read-only routing tools for V0.1 vertical slice
 *
 * Tools:
 * - list_models: List available models/routes
 * - route_task: Plan a route (NO execution, NO spend)
 * - get_task: Retrieve task status
 * - get_usage: Get usage summary
 *
 * run_task is intentionally NOT exposed in V0.1 (no execution adapters yet)
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

// ============================================================================
// Server Configuration
// ============================================================================

const server = new Server(
  {
    name: 'gptrouter-mcp',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// ============================================================================
// Tool Definitions (V0.1: Read-only, planning tools only)
// ============================================================================

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'list_models',
        description:
          'List available AI models and routes. Returns models with capabilities, pricing, and availability. Read-only, no API calls made.',
        inputSchema: {
          type: 'object',
          properties: {
            capability_filter: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Optional: Filter models by required capabilities (e.g., ["text", "vision"])',
            },
            provider_filter: {
              type: 'string',
              description: 'Optional: Filter by provider ID',
            },
          },
        },
      },
      {
        name: 'route_task',
        description:
          'Plan the best route for a task based on requirements and policy. DOES NOT execute or spend money. Returns routing decision with estimated cost and selected route.',
        inputSchema: {
          type: 'object',
          properties: {
            description: {
              type: 'string',
              description: 'Human-readable task description',
            },
            required_capabilities: {
              type: 'array',
              items: { type: 'string' },
              description: 'Required capabilities (e.g., ["text"], ["vision", "audio"])',
            },
            ordering_strategy: {
              type: 'string',
              enum: ['cost'],
              description: 'Routing strategy (V0.1: only "cost" is operational)',
            },
          },
          required: ['description', 'required_capabilities'],
        },
      },
      {
        name: 'get_task',
        description:
          'Retrieve task status and routing decision. Returns task details, selected route, and execution status if applicable.',
        inputSchema: {
          type: 'object',
          properties: {
            task_id: {
              type: 'string',
              description: 'Task ID from route_task response',
            },
          },
          required: ['task_id'],
        },
      },
      {
        name: 'get_usage',
        description:
          'Get usage summary and cost breakdown. Returns aggregate usage statistics and cost information. Read-only.',
        inputSchema: {
          type: 'object',
          properties: {
            time_range: {
              type: 'string',
              enum: ['today', 'week', 'month'],
              description: 'Time range for usage data',
            },
          },
        },
      },
    ],
  };
});

// ============================================================================
// Tool Handlers (V0.1: Mock implementations for vertical slice)
// ============================================================================

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'list_models': {
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
        if (args?.capability_filter) {
          const required = args.capability_filter as string[];
          filtered = filtered.filter((m) => required.every((cap) => m.capabilities.includes(cap)));
        }
        if (args?.provider_filter) {
          filtered = filtered.filter((m) => m.source_provider === args.provider_filter);
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ models: filtered }, null, 2),
            },
          ],
        };
      }

      case 'route_task': {
        // V0.1: Return mock routing decision
        // Real implementation would use RoutingEngine with account context
        const taskId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        const decision = {
          decision_id: `decision_${Math.random().toString(36).slice(2, 11)}`,
          task_id: taskId,
          status: 'planning',
          description: args?.description || 'Task',
          required_capabilities: args?.required_capabilities || ['text'],
          selected_route: {
            route_id: 'route-gpt4-mini',
            source_id: 'gpt-4-mini',
            route_type: 'provider',
            source_provider: 'openai',
          },
          estimated_cost: 0.0002,
          ordering_strategy: args?.ordering_strategy || 'cost',
          decided_at: new Date().toISOString(),
          note: 'V0.1: This is a planning decision only. No execution or spending occurs.',
        };

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(decision, null, 2),
            },
          ],
        };
      }

      case 'get_task': {
        if (!args?.task_id) {
          throw new Error('task_id is required');
        }

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
              type: 'text',
              text: JSON.stringify(task, null, 2),
            },
          ],
        };
      }

      case 'get_usage': {
        // V0.1: Return mock usage data
        const usage = {
          time_range: args?.time_range || 'today',
          total_requests: 0,
          total_cost: 0.0,
          cost_breakdown: {},
          note: 'V0.1: Usage tracking not yet implemented. Returns zero usage.',
        };

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(usage, null, 2),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
          }),
        },
      ],
      isError: true,
    };
  }
});

// ============================================================================
// Server Startup
// ============================================================================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('GPTRouter MCP Server started');
  console.error('V0.1: Exposes safe, read-only routing tools');
  console.error('Available tools: list_models, route_task, get_task, get_usage');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
