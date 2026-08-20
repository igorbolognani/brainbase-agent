import { describe, expect, it } from 'vitest';
import { createSyntheticGPTRouterApplication } from '../application.js';
import { createGPTRouterHandlers } from '../handlers.js';

function freshHandlers() {
  return createGPTRouterHandlers(createSyntheticGPTRouterApplication());
}

function parseText(result: { content: Array<{ type: string; text: string }> }) {
  return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

describe('MCP Tool Handlers — repository-backed synthetic state', () => {
  it('lists clearly synthetic repository-backed routes', async () => {
    const handlers = freshHandlers();
    const parsed = parseText(await handlers.listModelsHandler({}));
    const models = parsed.models as Array<{
      route_id: string;
      source_id: string;
      source_provider: string;
      provenance: string;
      pricing: { source: string };
    }>;

    expect(parsed.data_mode).toBe('synthetic_repository');
    expect(models).toHaveLength(2);
    expect(models.map((model) => model.route_id)).toEqual([
      'route-synthetic-text-free',
      'route-synthetic-multimodal-cheap',
    ]);
    expect(models.every((model) => model.source_id.startsWith('synthetic-'))).toBe(true);
    expect(models.every((model) => model.source_provider.startsWith('synthetic-provider-'))).toBe(
      true
    );
    expect(models.every((model) => model.provenance === 'synthetic_repository')).toBe(true);
    expect(models.every((model) => model.pricing.source === 'synthetic-fixture')).toBe(true);
  });

  it('filters routes by capability and provider', async () => {
    const handlers = freshHandlers();
    const capabilityResult = parseText(
      await handlers.listModelsHandler({ capability_filter: ['vision'] })
    );
    const capabilityModels = capabilityResult.models as Array<{ route_id: string }>;
    expect(capabilityModels.map((model) => model.route_id)).toEqual([
      'route-synthetic-multimodal-cheap',
    ]);

    const providerResult = parseText(
      await handlers.listModelsHandler({ provider_filter: 'synthetic-provider-alpha' })
    );
    const providerModels = providerResult.models as Array<{ route_id: string }>;
    expect(providerModels.map((model) => model.route_id)).toEqual(['route-synthetic-text-free']);
  });

  it('plans through the real routing engine and prefers an adequate free route', async () => {
    const handlers = freshHandlers();
    const parsed = parseText(
      await handlers.routeTaskHandler({
        description: 'Synthetic text planning task',
        required_capabilities: ['text'],
        ordering_strategy: 'cost',
      })
    );

    expect(parsed.task_id).toMatch(/^task_/);
    expect(parsed.status).toBe('planning');
    expect(parsed.data_mode).toBe('synthetic_repository');
    expect(parsed.actual_cost).toBe(0);
    expect(parsed.estimated_cost).toBe(0);
    expect((parsed.selected_route as { route_id: string }).route_id).toBe(
      'route-synthetic-text-free'
    );
    expect(parsed.note).toContain('No provider execution or spending occurs');
  });

  it('selects the lowest-cost route that actually satisfies multimodal capability', async () => {
    const handlers = freshHandlers();
    const parsed = parseText(
      await handlers.routeTaskHandler({
        description: 'Synthetic vision planning task',
        required_capabilities: ['text', 'vision'],
        ordering_strategy: 'cost',
      })
    );

    expect((parsed.selected_route as { route_id: string }).route_id).toBe(
      'route-synthetic-multimodal-cheap'
    );
    expect(parsed.estimated_cost).toBeCloseTo(0.003);
    expect(parsed.actual_cost).toBe(0);
  });

  it('retrieves the exact task written by a prior route_task call', async () => {
    const handlers = freshHandlers();
    const planned = parseText(
      await handlers.routeTaskHandler({
        description: 'Persist me',
        required_capabilities: ['text'],
        ordering_strategy: 'cost',
      })
    );
    const retrieved = parseText(
      await handlers.getTaskHandler({ task_id: planned.task_id as string })
    );

    expect((retrieved.task as { task_id: string }).task_id).toBe(planned.task_id);
    expect((retrieved.task as { description: string }).description).toBe('Persist me');
    expect((retrieved.latest_decision as { decision_id: string }).decision_id).toBe(
      planned.decision_id
    );
    expect(retrieved.execution_status).toBe('not_started');
    expect(retrieved.actual_cost).toBe(0);
  });

  it('returns a non-enumerating not-found projection for unknown task IDs', async () => {
    const handlers = freshHandlers();
    const parsed = parseText(await handlers.getTaskHandler({ task_id: 'missing-task' }));
    expect(parsed).toEqual({
      error: 'task_not_found',
      task_id: 'missing-task',
      data_mode: 'synthetic_repository',
    });
  });

  it('keeps planning estimates separate from actual usage/spend', async () => {
    const handlers = freshHandlers();
    await handlers.routeTaskHandler({
      description: 'Estimated but never executed',
      required_capabilities: ['vision'],
      ordering_strategy: 'cost',
    });
    const usage = parseText(await handlers.getUsageHandler({ time_range: 'week' }));

    expect(usage.time_range).toBe('week');
    expect(usage.planning_requests).toBe(1);
    expect(usage.execution_requests).toBe(0);
    expect(usage.actual_usage_records).toBe(0);
    expect(usage.actual_cost).toBe(0);
    expect(usage.estimated_planned_cost).toBeCloseTo(0.003);
    expect(usage.data_mode).toBe('synthetic_repository');
  });
});
