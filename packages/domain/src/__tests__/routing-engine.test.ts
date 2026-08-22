/**
 * Tests for routing engine with synthetic fixtures.
 * NO hardcoded production model names or prices.
 */

import { describe, it, expect } from 'vitest';
import { RoutingEngine } from '../routing-engine.js';
import type { Task, ModelRoute, RoutingPolicy } from '@gptrouter/contracts';

// ============================================================================
// Synthetic Fixtures
// ============================================================================

function createTestTask(capabilities: string[]): Task {
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
  available = true
): ModelRoute {
  return {
    route_id: id,
    route_type: 'provider',
    connection_id: 'test-connection-1',
    source_id: `test-model-${id}`,
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
    availability_status: available ? 'available' : 'unavailable',
    created_at: new Date(),
    updated_at: new Date(),
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

// ============================================================================
// Tests
// ============================================================================

describe('RoutingEngine', () => {
  describe('planRoute - admissibility', () => {
    it('should select route with required capabilities', async () => {
      const engine = new RoutingEngine({
        checkBudget: async () => ({ allowed: true }),
        estimateCost: (route) => route.pricing.input_cost_per_1k_tokens,
      });

      const task = createTestTask(['text']);
      const routes = [
        createTestRoute('route-1', ['text'], 0.001),
        createTestRoute('route-2', ['vision'], 0.01),
      ];
      const policy = createTestPolicy();

      const decision = await engine.planRoute(task, policy, routes);

      expect(decision.selected_route_id).toBe('route-1');
      expect(decision.admissible_routes).toEqual(['route-1']);
      expect(decision.rejection_reasons).toHaveLength(1);
      expect(decision.rejection_reasons[0].reason_code).toBe('insufficient_capability');
    });

    it('should reject unavailable routes', async () => {
      const engine = new RoutingEngine({
        checkBudget: async () => ({ allowed: true }),
        estimateCost: (route) => route.pricing.input_cost_per_1k_tokens,
      });

      const task = createTestTask(['text']);
      const routes = [createTestRoute('route-1', ['text'], 0.001, false)];
      const policy = createTestPolicy();

      const decision = await engine.planRoute(task, policy, routes);

      expect(decision.selected_route_id).toBeNull();
      expect(decision.admissible_routes).toEqual([]);
      expect(decision.rejection_reasons[0].reason_code).toBe('unavailable');
    });

    it('should reject routes exceeding budget', async () => {
      const engine = new RoutingEngine({
        checkBudget: async (_account, cost) => ({
          allowed: cost <= 0.01,
          reason: cost > 0.01 ? 'Budget exceeded' : undefined,
        }),
        estimateCost: (route) => route.pricing.input_cost_per_1k_tokens,
      });

      const task = createTestTask(['text']);
      const routes = [
        createTestRoute('route-1', ['text'], 0.001),
        createTestRoute('route-2', ['text'], 0.1),
      ];
      const policy = createTestPolicy();

      const decision = await engine.planRoute(task, policy, routes);

      expect(decision.selected_route_id).toBe('route-1');
      expect(decision.admissible_routes).toEqual(['route-1']);
      expect(
        decision.rejection_reasons.find((r: any) => r.route_id === 'route-2')?.reason_code
      ).toBe('budget_exceeded_per_task');
    });

    it('should respect policy route type restrictions', async () => {
      const engine = new RoutingEngine({
        checkBudget: async () => ({ allowed: true }),
        estimateCost: (route) => route.pricing.input_cost_per_1k_tokens,
      });

      const task = createTestTask(['text']);
      const routes = [
        { ...createTestRoute('route-1', ['text'], 0.001), route_type: 'provider' as const },
        { ...createTestRoute('route-2', ['text'], 0.001), route_type: 'gateway' as const },
      ];
      const policy = createTestPolicy({
        admissibility_rules: { allowed_route_types: ['provider'] },
      });

      const decision = await engine.planRoute(task, policy, routes);

      expect(decision.selected_route_id).toBe('route-1');
      expect(decision.admissible_routes).toEqual(['route-1']);
      expect(
        decision.rejection_reasons.find((r: any) => r.route_id === 'route-2')?.reason_code
      ).toBe('policy_violation_route_type');
    });
  });

  describe('planRoute - ordering', () => {
    it('should order by cost (lowest first)', async () => {
      const engine = new RoutingEngine({
        checkBudget: async () => ({ allowed: true }),
        estimateCost: (route) => route.pricing.input_cost_per_1k_tokens,
      });

      const task = createTestTask(['text']);
      const routes = [
        createTestRoute('route-expensive', ['text'], 0.1),
        createTestRoute('route-cheap', ['text'], 0.001),
        createTestRoute('route-medium', ['text'], 0.01),
      ];
      const policy = createTestPolicy({ ordering_strategy: 'cost' });

      const decision = await engine.planRoute(task, policy, routes);

      expect(decision.selected_route_id).toBe('route-cheap');
      expect(decision.estimated_cost).toBe(0.001);
    });

    it('should fail closed when quality ordering is unsupported', async () => {
      const engine = new RoutingEngine({
        checkBudget: async () => ({ allowed: true }),
        estimateCost: (route) => route.pricing.input_cost_per_1k_tokens,
      });

      const task = createTestTask(['text']);
      const routes = [
        createTestRoute('route-basic', ['text'], 0.001),
        createTestRoute('route-advanced', ['text', 'vision', 'audio'], 0.1),
      ];
      const policy = createTestPolicy({ ordering_strategy: 'quality' });

      const decision = await engine.planRoute(task, policy, routes);

      // V0.1: Quality ordering is unsupported - fails closed, no route selected
      expect(decision.selected_route_id).toBeNull();
      expect(decision.ordering_strategy_unsupported).toBe(true);
      expect(decision.admissible_routes).toHaveLength(2);
    });
  });

  describe('planRoute - provenance', () => {
    it('should capture full routing provenance', async () => {
      const engine = new RoutingEngine({
        checkBudget: async () => ({ allowed: true }),
        estimateCost: (route) => route.pricing.input_cost_per_1k_tokens,
      });

      const task = createTestTask(['text']);
      const routes = [createTestRoute('route-1', ['text'], 0.001)];
      const policy = createTestPolicy();

      const decision = await engine.planRoute(task, policy, routes);

      expect(decision.decision_id).toBeDefined();
      expect(decision.task_id).toBe(task.task_id);
      expect(decision.policy_id).toBe(policy.policy_id);
      expect(decision.policy_version).toBe(policy.version);
      expect(decision.evaluated_routes).toEqual(['route-1']);
      expect(decision.route_snapshot).toBeDefined();
      expect(decision.route_snapshot?.pricing.version).toBe('1.0.0');
      expect(decision.decided_at).toBeInstanceOf(Date);
    });

    it('should snapshot selected route', async () => {
      const engine = new RoutingEngine({
        checkBudget: async () => ({ allowed: true }),
        estimateCost: (route) => route.pricing.input_cost_per_1k_tokens,
      });

      const task = createTestTask(['text']);
      const route = createTestRoute('route-1', ['text'], 0.001);
      const policy = createTestPolicy();

      const decision = await engine.planRoute(task, policy, [route]);

      const snapshot = decision.route_snapshot!;
      expect(snapshot.route_id).toBe(route.route_id);
      expect(snapshot.route_type).toBe(route.route_type);
      expect(snapshot.connection_id).toBe(route.connection_id);
      expect(snapshot.source_id).toBe(route.source_id);
      expect(snapshot.policy_version).toBe(policy.version);
      expect(snapshot.pricing).toEqual(route.pricing);
    });
  });

  describe('validateManualOverride', () => {
    it('should allow override if policy permits and route is admissible', async () => {
      const engine = new RoutingEngine({
        checkBudget: async () => ({ allowed: true }),
        estimateCost: (route) => route.pricing.input_cost_per_1k_tokens,
      });

      const task = createTestTask(['text']);
      const route = createTestRoute('route-1', ['text'], 0.001);
      const policy = createTestPolicy({ manual_override_allowed: true });

      const result = await engine.validateManualOverride(route, task, policy);

      expect(result.valid).toBe(true);
    });

    it('should reject override if policy forbids it', async () => {
      const engine = new RoutingEngine({
        checkBudget: async () => ({ allowed: true }),
        estimateCost: (route) => route.pricing.input_cost_per_1k_tokens,
      });

      const task = createTestTask(['text']);
      const route = createTestRoute('route-1', ['text'], 0.001);
      const policy = createTestPolicy({ manual_override_allowed: false });

      const result = await engine.validateManualOverride(route, task, policy);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('not allowed');
    });

    it('should reject override if route not admissible', async () => {
      const engine = new RoutingEngine({
        checkBudget: async () => ({ allowed: true }),
        estimateCost: (route) => route.pricing.input_cost_per_1k_tokens,
      });

      const task = createTestTask(['text']);
      const route = createTestRoute('route-1', ['vision'], 0.001); // Wrong capability
      const policy = createTestPolicy({ manual_override_allowed: true });

      const result = await engine.validateManualOverride(route, task, policy);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('capabilities');
    });
  });
});
