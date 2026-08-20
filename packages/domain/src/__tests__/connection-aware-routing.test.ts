import { describe, expect, it, vi } from 'vitest';
import type {
  Connection,
  GatewayConnection,
  ModelRoute,
  ProviderConnection,
  RoutingPolicy,
  Task,
} from '@gptrouter/contracts';
import { RoutingEngine } from '../routing-engine.js';

const NOW = new Date('2026-08-20T00:00:00.000Z');

function task(): Task {
  return {
    task_id: 'task-1',
    account_id: 'account-1',
    description: 'Synthetic routing task',
    requirements: { capabilities: ['text'] },
    status: 'planning',
    created_at: NOW,
  };
}

function policy(overrides: Partial<RoutingPolicy> = {}): RoutingPolicy {
  return {
    policy_id: 'policy-1',
    account_id: 'account-1',
    name: 'HTTPS required',
    ordering_strategy: 'cost',
    admissibility_rules: { require_https: true },
    budget_constraints: {},
    manual_override_allowed: true,
    version: 1,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function price() {
  return {
    input_cost_per_1k_tokens: 0,
    output_cost_per_1k_tokens: 0,
    currency: 'USD',
    units: 'per_1k_tokens',
    source: 'synthetic',
    effective_at: NOW,
    refreshed_at: NOW,
    version: 'test',
  };
}

function gatewayRoute(): ModelRoute {
  return {
    route_id: 'gateway-route-1',
    route_type: 'gateway',
    connection_id: 'gateway-connection-1',
    source_id: 'synthetic-model',
    source_gateway: 'synthetic-gateway',
    capabilities: ['text'],
    pricing: price(),
    availability_status: 'available',
    created_at: NOW,
    updated_at: NOW,
  };
}

function providerRoute(): ModelRoute {
  return {
    ...gatewayRoute(),
    route_id: 'provider-route-1',
    route_type: 'provider',
    connection_id: 'provider-connection-1',
    source_gateway: undefined,
    source_provider: 'synthetic-provider',
  };
}

function gatewayConnection(
  overrides: Partial<GatewayConnection> = {}
): GatewayConnection {
  return {
    type: 'gateway',
    connection_id: 'gateway-connection-1',
    account_id: 'account-1',
    gateway_url: 'https://gateway.example.com/v1',
    gateway_type: 'synthetic-gateway',
    status: 'active',
    credential_reference: 'opaque-secret-reference',
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function providerConnection(): ProviderConnection {
  return {
    type: 'provider',
    connection_id: 'gateway-connection-1',
    account_id: 'account-1',
    provider: 'synthetic-provider',
    status: 'active',
    credential_reference: 'opaque-secret-reference',
    created_at: NOW,
    updated_at: NOW,
  };
}

function engine(connection: Connection | null, getConnection = vi.fn(async () => connection)) {
  return {
    instance: new RoutingEngine({
      checkBudget: async () => ({ allowed: true }),
      estimateCost: () => 0,
      getConnection,
    }),
    getConnection,
  };
}

async function rejectionFor(connection: Connection | null) {
  const { instance } = engine(connection);
  const decision = await instance.planRoute(task(), policy(), [gatewayRoute()]);
  return decision.rejection_reasons[0];
}

describe('connection-aware HTTPS routing', () => {
  it('accepts an active same-account HTTPS gateway', async () => {
    const { instance } = engine(gatewayConnection());
    const decision = await instance.planRoute(task(), policy(), [gatewayRoute()]);

    expect(decision.selected_route_id).toBe('gateway-route-1');
    expect(decision.rejection_reasons).toEqual([]);
  });

  it('rejects an HTTP gateway URL', async () => {
    const rejection = await rejectionFor(gatewayConnection({ gateway_url: 'http://gateway.example.com' }));
    expect(rejection).toMatchObject({ reason_code: 'policy_violation_security' });
    expect(rejection.details).toContain('HTTPS');
  });

  it('rejects gateway URL userinfo', async () => {
    const rejection = await rejectionFor(
      gatewayConnection({ gateway_url: 'https://user:password@gateway.example.com' })
    );
    expect(rejection.details).toContain('credentials');
  });

  it('rejects missing gateway connection metadata', async () => {
    const rejection = await rejectionFor(null);
    expect(rejection.details).toContain('missing');
  });

  it('rejects the wrong persisted connection type', async () => {
    const rejection = await rejectionFor(providerConnection());
    expect(rejection.details).toContain('not a gateway');
  });

  it.each(['revoked', 'expired', 'error'] as const)('rejects %s gateway connections', async (status) => {
    const rejection = await rejectionFor(gatewayConnection({ status }));
    expect(rejection.details).toContain(status);
  });

  it('rejects a cross-account gateway connection', async () => {
    const rejection = await rejectionFor(gatewayConnection({ account_id: 'account-2' }));
    expect(rejection.details).toContain('task account');
  });

  it('does not require gateway metadata for provider routes', async () => {
    const getConnection = vi.fn(async () => null);
    const { instance } = engine(null, getConnection);
    const decision = await instance.planRoute(task(), policy(), [providerRoute()]);

    expect(decision.selected_route_id).toBe('provider-route-1');
    expect(getConnection).not.toHaveBeenCalled();
  });

  it('fails closed when the connection resolver is unavailable', async () => {
    const instance = new RoutingEngine({
      checkBudget: async () => ({ allowed: true }),
      estimateCost: () => 0,
    });
    const decision = await instance.planRoute(task(), policy(), [gatewayRoute()]);

    expect(decision.selected_route_id).toBeNull();
    expect(decision.rejection_reasons[0].details).toContain('resolver');
  });

  it('applies the same HTTPS metadata gate to manual overrides', async () => {
    const { instance } = engine(gatewayConnection({ gateway_url: 'http://gateway.example.com' }));
    const result = await instance.validateManualOverride(gatewayRoute(), task(), policy());

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('HTTPS');
  });

  it('does not resolve connection metadata when require_https is disabled', async () => {
    const getConnection = vi.fn(async () => gatewayConnection());
    const { instance } = engine(gatewayConnection(), getConnection);
    const decision = await instance.planRoute(
      task(),
      policy({ admissibility_rules: { require_https: false } }),
      [gatewayRoute()]
    );

    expect(decision.selected_route_id).toBe('gateway-route-1');
    expect(getConnection).not.toHaveBeenCalled();
  });
});
