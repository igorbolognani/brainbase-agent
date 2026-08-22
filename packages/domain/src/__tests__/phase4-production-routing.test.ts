/**
 * Phase 4 production-style routing tests.
 * Tests RoutingEngine with in-memory mocks for optional deps.
 * NO HTTP calls, NO hardcoded production model names/prices.
 */

import { describe, it, expect } from 'vitest';
import { RoutingEngine } from '../routing-engine.js';
import type {
  Task,
  ModelRoute,
  RoutingPolicy,
  HealthState,
  ModelOffering,
} from '@gptrouter/contracts';

// ============================================================================
// Synthetic Fixtures
// ============================================================================

function createTestTask(capabilities: string[] = ['text_generation']): Task {
  return {
    task_id: 'test-task-1',
    account_id: 'test-account-1',
    description: 'Test task',
    requirements: { capabilities },
    status: 'planning',
    created_at: new Date(),
  };
}

function createTestRoute(
  id: string,
  capabilities: string[],
  cost: number,
  overrides: Partial<ModelRoute> = {}
): ModelRoute {
  return {
    route_id: id,
    route_type: 'provider',
    connection_id: `conn-${id}`,
    source_id: `model-${id}`,
    source_provider: 'test-provider',
    capabilities,
    pricing: {
      input_cost_per_1k_tokens: cost,
      output_cost_per_1k_tokens: cost * 2,
      currency: 'USD',
      units: 'per_1k_tokens',
      source: 'test-fixture',
      pricing_status: 'known_paid',
      effective_at: new Date(),
      refreshed_at: new Date(),
      version: '1.0.0',
    },
    availability_status: 'available',
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

function createTestPolicy(overrides: Partial<RoutingPolicy> = {}): RoutingPolicy {
  return {
    policy_id: 'test-policy-1',
    account_id: 'test-account-1',
    name: 'Test Policy',
    ordering_strategy: 'cost',
    admissibility_rules: {},
    budget_constraints: {},
    manual_override_allowed: true,
    version: 1,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

function createTestOffering(
  provider: string,
  modelId: string,
  capabilities: string[] = ['text_generation']
): ModelOffering {
  return {
    offering_id: `offering-${provider}-${modelId}`,
    provider,
    model_id: modelId,
    display_name: `Test ${modelId}`,
    capabilities,
    context_window: 8192,
    max_output_tokens: 4096,
    supports_tools: false,
    supports_vision: false,
    supports_audio: false,
    supports_structured_output: false,
    supports_reasoning: false,
    pricing: {
      input_cost_per_1k_tokens: 0.01,
      output_cost_per_1k_tokens: 0.02,
      currency: 'USD',
      units: 'per_1k_tokens',
      source: 'test-fixture',
      pricing_status: 'known_paid',
      effective_at: new Date(),
      refreshed_at: new Date(),
      version: '1.0.0',
    },
    availability_status: 'available',
    health_state: 'healthy',
    effective_at: new Date(),
    refreshed_at: new Date(),
    version: '1.0.0',
  };
}

// ============================================================================
// Helper: create engine with mock deps
// ============================================================================

interface MockDeps {
  qualityScores?: Map<string, number>;
  healthStates?: Map<string, HealthState>;
  offerings?: Map<string, ModelOffering>;
  budgetAllowed?: boolean;
}

function createEngine(deps: MockDeps = {}): RoutingEngine {
  return new RoutingEngine({
    checkBudget: async () => ({ allowed: deps.budgetAllowed ?? true }),
    estimateCost: (route) =>
      route.pricing.input_cost_per_1k_tokens + route.pricing.output_cost_per_1k_tokens,
    getQualityScores: async (routeIds) => {
      if (!deps.qualityScores) return new Map();
      const result = new Map<string, number>();
      for (const id of routeIds) {
        const score = deps.qualityScores.get(id);
        if (score !== undefined) result.set(id, score);
      }
      return result;
    },
    getHealthStates: async (connectionIds) => {
      if (!deps.healthStates) return new Map();
      const result = new Map<string, HealthState>();
      for (const id of connectionIds) {
        const state = deps.healthStates.get(id);
        if (state !== undefined) result.set(id, state);
      }
      return result;
    },
    getOffering: async (provider, modelId) => {
      if (!deps.offerings) return null;
      return deps.offerings.get(`${provider}:${modelId}`) ?? null;
    },
  });
}

// ============================================================================
// Tests
// ============================================================================

describe('Phase 4: Production routing', () => {
  describe('1. Task routes through model offering with quality evidence', () => {
    it('selects route with best quality score', async () => {
      const qualityScores = new Map([
        ['route-a', 0.9],
        ['route-b', 0.6],
      ]);
      const engine = createEngine({ qualityScores });
      const task = createTestTask(['text_generation']);
      const policy = createTestPolicy({ ordering_strategy: 'quality' });
      const routes = [
        createTestRoute('route-a', ['text_generation'], 0.03),
        createTestRoute('route-b', ['text_generation'], 0.01),
      ];

      const decision = await engine.planRoute(task, policy, routes);

      expect(decision.selected_route_id).toBe('route-a');
      expect(decision.admissible_routes).toContain('route-a');
      expect(decision.admissible_routes).toContain('route-b');
    });
  });

  describe('2. Quality strategy with task-family evidence', () => {
    it('prefers route with higher quality score', async () => {
      const qualityScores = new Map([
        ['route-a', 0.85],
        ['route-b', 0.7],
      ]);
      const engine = createEngine({ qualityScores });
      const task = createTestTask(['text_generation']);
      const policy = createTestPolicy({ ordering_strategy: 'quality' });
      const routes = [
        createTestRoute('route-a', ['text_generation'], 0.03),
        createTestRoute('route-b', ['text_generation'], 0.01),
      ];

      const decision = await engine.planRoute(task, policy, routes);

      expect(decision.selected_route_id).toBe('route-a');
    });
  });

  describe('3. Quality strategy fail-closed when no evidence', () => {
    it('returns no selected route when no quality evidence exists', async () => {
      const engine = createEngine({});
      const task = createTestTask(['text_generation']);
      const policy = createTestPolicy({ ordering_strategy: 'quality' });
      const routes = [
        createTestRoute('route-a', ['text_generation'], 0.03),
        createTestRoute('route-b', ['text_generation'], 0.01),
      ];

      const decision = await engine.planRoute(task, policy, routes);

      expect(decision.selected_route_id).toBeNull();
      expect(decision.admissible_routes).toHaveLength(2);
    });
  });

  describe('4. Cost strategy fail-closed when pricing unknown', () => {
    it('returns no selected route when allow_unknown_pricing is false', async () => {
      const engine = createEngine();
      const task = createTestTask(['text_generation']);
      const policy = createTestPolicy({
        ordering_strategy: 'cost',
        allow_unknown_pricing: false,
      });
      const routes = [
        createTestRoute('route-a', ['text_generation'], 0.03, {
          pricing: {
            input_cost_per_1k_tokens: 0,
            output_cost_per_1k_tokens: 0,
            currency: 'USD',
            units: 'per_1k_tokens',
            source: 'unknown',
            pricing_status: 'unknown',
            effective_at: new Date(),
            refreshed_at: new Date(),
            version: '1.0.0',
          },
        }),
      ];

      const decision = await engine.planRoute(task, policy, routes);

      expect(decision.selected_route_id).toBeNull();
    });
  });

  describe('5. Balanced strategy with partial evidence', () => {
    it('scores using combined cost and quality', async () => {
      const qualityScores = new Map([
        ['route-a', 0.9],
        ['route-b', 0.4],
      ]);
      const engine = createEngine({ qualityScores });
      const task = createTestTask(['text_generation']);
      const policy = createTestPolicy({ ordering_strategy: 'balanced' });
      const routes = [
        createTestRoute('route-a', ['text_generation'], 0.05),
        createTestRoute('route-b', ['text_generation'], 0.01),
      ];

      const decision = await engine.planRoute(task, policy, routes);

      expect(decision.selected_route_id).not.toBeNull();
      expect(decision.admissible_routes).toHaveLength(2);
    });

    it('returns null ordering when no quality evidence for balanced', async () => {
      const engine = createEngine({});
      const task = createTestTask(['text_generation']);
      const policy = createTestPolicy({ ordering_strategy: 'balanced' });
      const routes = [
        createTestRoute('route-a', ['text_generation'], 0.05),
        createTestRoute('route-b', ['text_generation'], 0.01),
      ];

      const decision = await engine.planRoute(task, policy, routes);

      expect(decision.selected_route_id).toBeNull();
      expect(decision.admissible_routes).toHaveLength(2);
    });
  });

  describe('6. Health as admissibility (disabled/unavailable routes excluded)', () => {
    it('excludes disabled routes from admissibility', async () => {
      const healthStates = new Map<string, HealthState>([
        ['conn-route-a', 'healthy'],
        ['conn-route-b', 'disabled'],
      ]);
      const engine = createEngine({ healthStates });
      const task = createTestTask(['text_generation']);
      const policy = createTestPolicy({ ordering_strategy: 'cost' });
      const routes = [
        createTestRoute('route-a', ['text_generation'], 0.03),
        createTestRoute('route-b', ['text_generation'], 0.01),
      ];

      const decision = await engine.planRoute(task, policy, routes);

      expect(decision.selected_route_id).toBe('route-a');
      expect(decision.admissible_routes).not.toContain('route-b');
      expect(decision.rejection_reasons).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            route_id: 'route-b',
            reason_code: 'unavailable',
          }),
        ])
      );
    });

    it('excludes unavailable routes from admissibility', async () => {
      const healthStates = new Map<string, HealthState>([
        ['conn-route-a', 'healthy'],
        ['conn-route-b', 'unavailable'],
      ]);
      const engine = createEngine({ healthStates });
      const task = createTestTask(['text_generation']);
      const policy = createTestPolicy({ ordering_strategy: 'cost' });
      const routes = [
        createTestRoute('route-a', ['text_generation'], 0.03),
        createTestRoute('route-b', ['text_generation'], 0.01),
      ];

      const decision = await engine.planRoute(task, policy, routes);

      expect(decision.admissible_routes).not.toContain('route-b');
    });
  });

  describe('7. Capability from offering overrides route capabilities', () => {
    it('rejects route when offering lacks required capability', async () => {
      const offerings = new Map<string, ModelOffering>();
      offerings.set('test-provider:model-a', createTestOffering('test-provider', 'model-a', []));
      const engine = createEngine({ offerings });
      const task = createTestTask(['code_execution']);
      const policy = createTestPolicy({ ordering_strategy: 'cost' });
      const routes = [
        createTestRoute('route-a', ['code_execution'], 0.03, {
          source_provider: 'test-provider',
          source_id: 'model-a',
        }),
      ];

      const decision = await engine.planRoute(task, policy, routes);

      expect(decision.selected_route_id).toBeNull();
      expect(decision.rejection_reasons).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            route_id: 'route-a',
            reason_code: 'insufficient_capability',
          }),
        ])
      );
    });

    it('allows route when offering has required capability', async () => {
      const offerings = new Map<string, ModelOffering>();
      offerings.set(
        'test-provider:model-a',
        createTestOffering('test-provider', 'model-a', ['code_execution'])
      );
      const engine = createEngine({ offerings });
      const task = createTestTask(['code_execution']);
      const policy = createTestPolicy({ ordering_strategy: 'cost' });
      const routes = [
        createTestRoute('route-a', ['code_execution'], 0.03, {
          source_provider: 'test-provider',
          source_id: 'model-a',
        }),
      ];

      const decision = await engine.planRoute(task, policy, routes);

      expect(decision.selected_route_id).toBe('route-a');
    });
  });

  describe('8. Unknown capability fail-closed', () => {
    it('rejects route with no matching capabilities', async () => {
      const engine = createEngine();
      const task = createTestTask(['code_execution']);
      const policy = createTestPolicy({ ordering_strategy: 'cost' });
      const routes = [createTestRoute('route-a', ['text_generation'], 0.03)];

      const decision = await engine.planRoute(task, policy, routes);

      expect(decision.selected_route_id).toBeNull();
      expect(decision.rejection_reasons).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            route_id: 'route-a',
            reason_code: 'insufficient_capability',
          }),
        ])
      );
    });
  });

  describe('9. Structured explanation output', () => {
    it('includes rejection reasons for inadmissible routes', async () => {
      const healthStates = new Map<string, HealthState>([
        ['conn-route-a', 'healthy'],
        ['conn-route-b', 'disabled'],
      ]);
      const engine = createEngine({ healthStates });
      const task = createTestTask(['text_generation']);
      const policy = createTestPolicy({ ordering_strategy: 'cost' });
      const routes = [
        createTestRoute('route-a', ['text_generation'], 0.03),
        createTestRoute('route-b', ['text_generation'], 0.01),
      ];

      const decision = await engine.planRoute(task, policy, routes);

      expect(decision.rejection_reasons.length).toBeGreaterThan(0);
      const rejected = decision.rejection_reasons.find((r) => r.route_id === 'route-b');
      expect(rejected).toBeDefined();
      expect(rejected!.reason_code).toBe('unavailable');
      expect(rejected!.details).toContain('disabled');
    });
  });

  describe('10. Tie-breaking deterministic', () => {
    it('breaks ties by route_id when scores are equal', async () => {
      const qualityScores = new Map([
        ['route-a', 0.8],
        ['route-b', 0.8],
        ['route-c', 0.8],
      ]);
      const engine = createEngine({ qualityScores });
      const task = createTestTask(['text_generation']);
      const policy = createTestPolicy({ ordering_strategy: 'quality' });
      const routes = [
        createTestRoute('route-c', ['text_generation'], 0.03),
        createTestRoute('route-a', ['text_generation'], 0.01),
        createTestRoute('route-b', ['text_generation'], 0.02),
      ];

      const decision = await engine.planRoute(task, policy, routes);

      expect(decision.selected_route_id).toBe('route-a');
    });

    it('deterministic across multiple runs', async () => {
      const qualityScores = new Map([
        ['route-a', 0.8],
        ['route-b', 0.8],
      ]);
      const engine = createEngine({ qualityScores });
      const task = createTestTask(['text_generation']);
      const policy = createTestPolicy({ ordering_strategy: 'quality' });
      const routes = [
        createTestRoute('route-b', ['text_generation'], 0.01),
        createTestRoute('route-a', ['text_generation'], 0.02),
      ];

      const results = await Promise.all(
        Array.from({ length: 10 }, () => engine.planRoute(task, policy, routes))
      );

      const selectedIds = results.map((d) => d.selected_route_id);
      expect(new Set(selectedIds).size).toBe(1);
      expect(selectedIds[0]).toBe('route-a');
    });
  });
});
