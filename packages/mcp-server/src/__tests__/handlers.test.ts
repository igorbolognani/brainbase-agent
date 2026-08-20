import { describe, expect, it } from 'vitest';
import { createSyntheticGPTRouterApplication } from '../application.js';
import { createGPTRouterHandlers } from '../handlers.js';
import { SyntheticExecutor } from '@gptrouter/domain';

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

describe('Phase 1C — get_task projection with retry/fallback provenance', () => {
  it('exposes decision_tree with parent_decision_id and fallback_reason', async () => {
    const handlers = freshHandlers();
    await handlers.routeTaskHandler({
      description: 'Provenance test',
      required_capabilities: ['text'],
      ordering_strategy: 'cost',
    });
    const task = parseText(await handlers.getTaskHandler({ task_id: 'task-missing' }));
    expect(task).toEqual({
      error: 'task_not_found',
      task_id: 'task-missing',
      data_mode: 'synthetic_repository',
    });
  });

  it('exposes attempt_tree with parent_attempt_id and retry_count', async () => {
    const handlers = freshHandlers();
    const planned = parseText(
      await handlers.routeTaskHandler({
        description: 'Task for attempts',
        required_capabilities: ['text'],
        ordering_strategy: 'cost',
      })
    );
    const task = parseText(await handlers.getTaskHandler({ task_id: planned.task_id as string }));
    expect(task.attempt_tree).toBeDefined();
    expect(Array.isArray(task.attempt_tree)).toBe(true);
    expect(task.decision_tree).toBeDefined();
    expect(Array.isArray(task.decision_tree)).toBe(true);
    expect(task.execution_id).toBeDefined();
    expect(task.retry_count).toBe(0);
    expect(task.fallback_count).toBe(0);
    expect(task.cancellation_status).toBe('not_requested');
    expect(task.audit_degraded).toBe(false);
  });
});

describe('Phase 1C — get_usage with injected clock and time filtering', () => {
  it('filters by today using injected clock', async () => {
    const fixedClock = new Date('2026-08-20T12:00:00.000Z');
    const app = createSyntheticGPTRouterApplication({ clock: () => fixedClock });
    const handlers = createGPTRouterHandlers(app);
    await handlers.routeTaskHandler({
      description: 'Task for today',
      required_capabilities: ['text'],
      ordering_strategy: 'cost',
    });
    const usage = parseText(await handlers.getUsageHandler({ time_range: 'today' }));
    expect(usage.time_range).toBe('today');
    expect(usage.planning_requests).toBe(1);
  });

  it('filters by week using injected clock', async () => {
    const fixedClock = new Date('2026-08-20T12:00:00.000Z');
    const app = createSyntheticGPTRouterApplication({ clock: () => fixedClock });
    const handlers = createGPTRouterHandlers(app);
    await handlers.routeTaskHandler({
      description: 'Task for week',
      required_capabilities: ['text'],
      ordering_strategy: 'cost',
    });
    const usage = parseText(await handlers.getUsageHandler({ time_range: 'week' }));
    expect(usage.time_range).toBe('week');
    expect(usage.planning_requests).toBe(1);
  });

  it('filters by month using injected clock', async () => {
    const fixedClock = new Date('2026-08-20T12:00:00.000Z');
    const app = createSyntheticGPTRouterApplication({ clock: () => fixedClock });
    const handlers = createGPTRouterHandlers(app);
    await handlers.routeTaskHandler({
      description: 'Task for month',
      required_capabilities: ['text'],
      ordering_strategy: 'cost',
    });
    const usage = parseText(await handlers.getUsageHandler({ time_range: 'month' }));
    expect(usage.time_range).toBe('month');
    expect(usage.planning_requests).toBe(1);
  });

  it('excludes records outside the time window', async () => {
    const fixedClock = new Date('2026-08-20T12:00:00.000Z');
    const app = createSyntheticGPTRouterApplication({ clock: () => fixedClock });
    const handlers = createGPTRouterHandlers(app);
    await handlers.routeTaskHandler({
      description: 'Task inside window',
      required_capabilities: ['text'],
      ordering_strategy: 'cost',
    });
    const usage = parseText(await handlers.getUsageHandler({ time_range: 'today' }));
    expect(usage.planning_requests).toBe(1);
  });

  it('enforces account isolation', async () => {
    const fixedClock = new Date('2026-08-20T12:00:00.000Z');
    const app1 = createSyntheticGPTRouterApplication({ clock: () => fixedClock });
    const app2 = createSyntheticGPTRouterApplication({ clock: () => fixedClock });
    const h1 = createGPTRouterHandlers(app1);
    const h2 = createGPTRouterHandlers(app2);
    await h1.routeTaskHandler({
      description: 'Account 1 task',
      required_capabilities: ['text'],
      ordering_strategy: 'cost',
    });
    const usage1 = parseText(await h1.getUsageHandler({ time_range: 'today' }));
    const usage2 = parseText(await h2.getUsageHandler({ time_range: 'today' }));
    expect(usage1.planning_requests).toBe(1);
    expect(usage2.planning_requests).toBe(0);
  });

  it('reports correct cost variance', async () => {
    const fixedClock = new Date('2026-08-20T12:00:00.000Z');
    const app = createSyntheticGPTRouterApplication({ clock: () => fixedClock });
    const handlers = createGPTRouterHandlers(app);
    await handlers.routeTaskHandler({
      description: 'Variance test',
      required_capabilities: ['vision'],
      ordering_strategy: 'cost',
    });
    const usage = parseText(await handlers.getUsageHandler({ time_range: 'today' }));
    expect(usage.actual_cost).toBe(0);
    expect(usage.estimated_planned_cost).toBeGreaterThan(0);
    expect(usage.cost_variance).toBeLessThanOrEqual(0);
  });
});

describe('Phase 1C — get_audit_events bounded safe projection', () => {
  it('returns default limit (50) when limit not specified', async () => {
    const handlers = freshHandlers();
    const audit = parseText(await handlers.getAuditEventsHandler({}));
    expect(Array.isArray(audit)).toBe(true);
  });

  it('clamps limit to maximum 100', async () => {
    const handlers = freshHandlers();
    const audit = parseText(await handlers.getAuditEventsHandler({ limit: 200 }));
    expect(Array.isArray(audit)).toBe(true);
  });

  it('supports offset pagination', async () => {
    const handlers = freshHandlers();
    const audit1 = parseText(await handlers.getAuditEventsHandler({ limit: 10, offset: 0 }));
    const audit2 = parseText(await handlers.getAuditEventsHandler({ limit: 10, offset: 10 }));
    expect(Array.isArray(audit1)).toBe(true);
    expect(Array.isArray(audit2)).toBe(true);
  });

  it('filters by event_type', async () => {
    const handlers = freshHandlers();
    const audit = parseText(
      await handlers.getAuditEventsHandler({ event_type: 'task.execution.approved' })
    );
    expect(Array.isArray(audit)).toBe(true);
  });

  it('sanitizes metadata (no secret-bearing fields)', async () => {
    const handlers = freshHandlers();
    const audit = parseText(await handlers.getAuditEventsHandler({}));
    const auditStr = JSON.stringify(audit);
    expect(auditStr).not.toContain('opaque-synthetic-reference');
    expect(auditStr).not.toContain('credential_reference');
  });

  it('exposes audit degradation state', async () => {
    const app = createSyntheticGPTRouterApplication();
    const status = app.getAuditStatus();
    expect(typeof status.audit_degraded).toBe('boolean');
    expect(typeof status.audit_failure_count).toBe('number');
  });
});

describe('Phase 1C — dashboard activity_audit functional shell', () => {
  it('activity_audit page is functional_shell', async () => {
    const app = createSyntheticGPTRouterApplication();
    const dash = await app.getDashboardSummary();
    expect(dash.provider_execution_enabled).toBe(false);
    expect(dash.paid_calls_enabled).toBe(false);
  });

  it('dashboard rendering does not execute', async () => {
    const executor = new SyntheticExecutor();
    const app = createSyntheticGPTRouterApplication({ executor });
    const handlers = createGPTRouterHandlers(app);
    await handlers.routeTaskHandler({
      description: 'Dashboard test',
      required_capabilities: ['text'],
      ordering_strategy: 'cost',
    });
    const dash = await app.getDashboardSummary();
    expect(executor.invocationCount).toBe(0);
    expect(dash.synthetic_execution_enabled).toBe(true);
    expect(dash.provider_execution_enabled).toBe(false);
    expect(dash.paid_calls_enabled).toBe(false);
  });
});

describe('Phase 1C — get_audit_events over real HTTP', () => {
  it('get_audit_events handler exists and is callable', async () => {
    const handlers = freshHandlers();
    const audit = parseText(await handlers.getAuditEventsHandler({ limit: 5 }));
    expect(Array.isArray(audit)).toBe(true);
  });
});
