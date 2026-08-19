/**
 * Routing Engine Fail-Closed Tests
 * Verify that unsupported strategies and security requirements fail closed
 */

import { describe, it, expect } from 'vitest';
import { RoutingEngine } from '../routing-engine.js';
import type { Task, ModelRoute, RoutingPolicy, BudgetCheckResult } from '@gptrouter/contracts';

describe('RoutingEngine Fail-Closed Behavior', () => {
  const createTestPolicy = (overrides: Partial<RoutingPolicy> = {}): RoutingPolicy => ({
    policy_id: 'policy-1',
    account_id: 'account-1',
    name: 'Test Policy',
    version: 1,
    ordering_strategy: 'cost',
    admissibility_rules: {},
    budget_constraints: {},
    manual_override_allowed: false,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  });

  const mockTask: Task = {
    task_id: 'task-1',
    account_id: 'account-1',
    description: 'Test task',
    requirements: {
      capabilities: ['text'],
    },
    status: 'planning',
    created_at: new Date(),
  };

  const mockRoute: ModelRoute = {
    route_id: 'route-1',
    route_type: 'provider',
    connection_id: 'conn-1',
    source_id: 'gpt-4',
    source_provider: 'openai',
    capabilities: ['text', 'function-calling'],
    pricing: {
      input_cost_per_1k_tokens: 0.03,
      output_cost_per_1k_tokens: 0.06,
      currency: 'USD',
      units: 'per_1k_tokens',
      source: 'manual',
      effective_at: new Date(),
      refreshed_at: new Date(),
      version: '1.0',
    },
    availability_status: 'available',
    created_at: new Date(),
    updated_at: new Date(),
  };

  const mockGatewayRoute: ModelRoute = {
    ...mockRoute,
    route_id: 'route-gateway',
    route_type: 'gateway',
    source_gateway: 'gateway-1',
    source_provider: undefined,
  };

  const mockBudgetCheck: BudgetCheckResult = {
    allowed: true,
    remaining_daily: 100,
  };

  const mockDeps = {
    checkBudget: async () => mockBudgetCheck,
    estimateCost: () => 0.001,
  };

  describe('Unsupported Ordering Strategies', () => {
    it('fails closed for quality strategy with admissible routes', async () => {
      const policy = createTestPolicy({ ordering_strategy: 'quality' });
      const engine = new RoutingEngine(mockDeps);
      const decision = await engine.planRoute(mockTask, policy, [mockRoute]);

      // Should have admissible routes but NO selected route
      expect(decision.admissible_routes).toHaveLength(1);
      expect(decision.selected_route_id).toBeNull();
      expect(decision.ordering_strategy_unsupported).toBe(true);
    });

    it('fails closed for latency strategy with admissible routes', async () => {
      const policy = createTestPolicy({ ordering_strategy: 'latency' });
      const engine = new RoutingEngine(mockDeps);
      const decision = await engine.planRoute(mockTask, policy, [mockRoute]);

      expect(decision.admissible_routes).toHaveLength(1);
      expect(decision.selected_route_id).toBeNull();
      expect(decision.ordering_strategy_unsupported).toBe(true);
    });

    it('fails closed for custom strategy with admissible routes', async () => {
      const policy = createTestPolicy({ ordering_strategy: 'custom' });
      const engine = new RoutingEngine(mockDeps);
      const decision = await engine.planRoute(mockTask, policy, [mockRoute]);

      expect(decision.admissible_routes).toHaveLength(1);
      expect(decision.selected_route_id).toBeNull();
      expect(decision.ordering_strategy_unsupported).toBe(true);
    });

    it('succeeds with cost strategy (operational)', async () => {
      const policy = createTestPolicy({ ordering_strategy: 'cost' });
      const engine = new RoutingEngine(mockDeps);
      const decision = await engine.planRoute(mockTask, policy, [mockRoute]);

      expect(decision.admissible_routes).toHaveLength(1);
      expect(decision.selected_route_id).toBe('route-1');
      expect(decision.ordering_strategy_unsupported).toBeUndefined();
    });
  });

  describe('HTTPS Requirement Fail-Closed', () => {
    it('rejects gateway routes when require_https is enabled', async () => {
      const policy = createTestPolicy({
        admissibility_rules: { require_https: true },
      });
      const engine = new RoutingEngine(mockDeps);
      const decision = await engine.planRoute(mockTask, policy, [mockGatewayRoute]);

      // Gateway route should be rejected due to HTTPS requirement
      expect(decision.admissible_routes).toHaveLength(0);
      expect(decision.selected_route_id).toBeNull();
      expect(decision.rejection_reasons).toHaveLength(1);
      expect(decision.rejection_reasons[0].reason_code).toBe('policy_violation_security');
      expect(decision.rejection_reasons[0].details).toContain('HTTPS enforcement');
    });

    it('allows provider routes when require_https is enabled', async () => {
      const policy = createTestPolicy({
        admissibility_rules: { require_https: true },
      });
      const engine = new RoutingEngine(mockDeps);
      const decision = await engine.planRoute(mockTask, policy, [mockRoute]);

      // Provider route should pass (HTTPS check only applies to gateways)
      expect(decision.admissible_routes).toHaveLength(1);
      expect(decision.selected_route_id).toBe('route-1');
    });
  });

  describe('Manual Override Validation', () => {
    it('rejects manual override when not allowed by policy', async () => {
      const policy = createTestPolicy({ manual_override_allowed: false });
      const engine = new RoutingEngine(mockDeps);
      const result = await engine.validateManualOverride(mockRoute, mockTask, policy);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('not allowed');
    });

    it('applies same admissibility checks for manual override', async () => {
      const policy = createTestPolicy({
        admissibility_rules: { blocked_providers: ['openai'] },
        manual_override_allowed: true,
      });
      const engine = new RoutingEngine(mockDeps);
      const result = await engine.validateManualOverride(mockRoute, mockTask, policy);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('blocked');
    });

    it('allows valid manual override when permitted', async () => {
      const policy = createTestPolicy({ manual_override_allowed: true });
      const engine = new RoutingEngine(mockDeps);
      const result = await engine.validateManualOverride(mockRoute, mockTask, policy);

      expect(result.valid).toBe(true);
      expect(result.reason).toBeUndefined();
    });
  });
});
