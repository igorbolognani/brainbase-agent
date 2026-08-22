import { describe, expect, it } from 'vitest';
import {
  AdapterExecutionCoordinatorBridge,
  AdapterExecutionVerifier,
  DefaultProviderAdapterRegistry,
  FakeProviderAdapter,
  ProviderExecutionRequest,
} from '../provider-adapter.js';
import type { Task, RoutingDecision, ExecutionAttempt } from '@gptrouter/contracts';

describe('Fake Provider Adapter Boundary', () => {
  it('executes success path deterministically without credentials', async () => {
    const adapter = new FakeProviderAdapter({
      provider: 'openai',
      outcome: 'success',
      tokens_used: { input: 15, output: 25 },
      synthetic_cost: 0.001,
    });

    const request: ProviderExecutionRequest = {
      connection_id: 'conn_123_opaque',
      provider: 'openai',
      route_id: 'route_1',
      source_id: 'gpt-4o',
      route_type: 'provider',
      task_input: { prompt: 'hello' },
    };

    const result = await adapter.execute(request);

    expect(result.success).toBe(true);
    expect(result.provider).toBe('openai');
    expect(result.connection_id).toBe('conn_123_opaque');
    expect(result.tokens_used).toEqual({ input: 15, output: 25 });
    expect(result.actual_cost).toBe(0.001);
    expect(result.output).toHaveProperty('result', 'synthetic_fake_adapter_success');
  });

  it('fails closed and rejects request if raw secret fields are passed', async () => {
    const adapter = new FakeProviderAdapter();
    const badRequest = {
      connection_id: 'conn_123',
      provider: 'openai',
      route_id: 'route_1',
      source_id: 'gpt-4o',
      route_type: 'provider' as const,
      task_input: {},
      api_key: 'sk-proj-secret-key-should-never-be-here',
    };

    // Type assertion is intentional to test security boundary - we're verifying
    // the adapter rejects requests with raw credentials
    await expect(
      adapter.execute(badRequest as unknown as ProviderExecutionRequest)
    ).rejects.toThrow(/SECURITY_VIOLATION/);
  });

  it('classifies retryable vs terminal errors correctly', async () => {
    const retryableAdapter = new FakeProviderAdapter({
      outcome: 'retryable_failure',
      failure_classification: 'rate_limited',
    });

    const terminalAdapter = new FakeProviderAdapter({
      outcome: 'terminal_failure',
      failure_classification: 'invalid_request',
    });

    const req: ProviderExecutionRequest = {
      connection_id: 'conn_1',
      provider: 'fake',
      route_id: 'r_1',
      source_id: 'm_1',
      route_type: 'provider',
      task_input: {},
    };

    const res1 = await retryableAdapter.execute(req);
    expect(res1.success).toBe(false);
    expect(res1.is_retryable).toBe(true);
    expect(res1.error_classification).toBe('rate_limited');

    const res2 = await terminalAdapter.execute(req);
    expect(res2.success).toBe(false);
    expect(res2.is_retryable).toBe(false);
    expect(res2.error_classification).toBe('invalid_request');
  });

  it('integrates with Bridge and Verifier seamlessly', async () => {
    const registry = new DefaultProviderAdapterRegistry();
    const adapter = new FakeProviderAdapter({
      outcome: 'retryable_failure',
      failure_classification: 'provider_unavailable',
    });
    registry.registerAdapter('test_provider', adapter);

    const bridge = new AdapterExecutionCoordinatorBridge({
      registry,
      credentialResolver: { resolveCredential: async () => 'test-cred' },
    });
    const verifier = new AdapterExecutionVerifier();

    const mockTask: Task = {
      task_id: 't_1',
      account_id: 'acc_1',
      description: 'test',
      requirements: { capabilities: ['text'] },
      status: 'approved',
      created_at: new Date(),
    };

    const mockDecision: RoutingDecision = {
      decision_id: 'd_1',
      task_id: 't_1',
      policy_id: 'p_1',
      policy_version: 1,
      evaluated_routes: ['r_1'],
      admissible_routes: ['r_1'],
      selected_route_id: 'r_1',
      route_snapshot: {
        route_id: 'r_1',
        route_type: 'provider',
        connection_id: 'c_1',
        source_id: 'm_1',
        source_provider: 'test_provider',
        pricing: {
          input_cost_per_1k_tokens: 0,
          output_cost_per_1k_tokens: 0,
          currency: 'USD',
          units: '1k',
          source: 'test',
          pricing_status: 'known_free' as const,
          effective_at: new Date(),
          refreshed_at: new Date(),
          version: '1',
        },
        policy_version: 1,
      },
      rejection_reasons: [],
      estimated_cost: 0,
      decided_at: new Date(),
    };

    const mockAttempt: ExecutionAttempt = {
      attempt_id: 'att_1',
      account_id: 'acc_1',
      execution_id: 'exec_1',
      task_id: 't_1',
      decision_id: 'd_1',
      idempotency_key: 'idem_1',
      status: 'running',
      started_at: new Date(),
      completed_at: null,
      cancel_requested_at: null,
      cancelled_at: null,
      retry_count: 0,
      retry_policy: null,
      parent_attempt_id: null,
      verification_outcome: null,
      failure_code: null,
      created_at: new Date(),
    };

    const output = await bridge.execute({
      task: mockTask,
      decision: mockDecision,
      attempt: mockAttempt,
    });

    const verification = await verifier.verify(output, {
      task: mockTask,
      decision: mockDecision,
      attempt: mockAttempt,
    });

    expect(verification.outcome).toBe('retryable_failure');
    expect(verification.failure_code).toBe('provider_unavailable');
  });

  it('fails closed for unknown adapter with terminal failure', async () => {
    const registry = new DefaultProviderAdapterRegistry();
    const bridge = new AdapterExecutionCoordinatorBridge({
      registry,
      credentialResolver: { resolveCredential: async () => 'test-cred' },
    });
    const verifier = new AdapterExecutionVerifier();

    const mockTask = {
      task_id: 't_1',
      account_id: 'acc_1',
      description: 'test',
      requirements: { capabilities: ['text'] },
      status: 'approved' as const,
      created_at: new Date(),
    };

    const mockDecision = {
      decision_id: 'd_1',
      task_id: 't_1',
      policy_id: 'p_1',
      policy_version: 1,
      evaluated_routes: ['r_1'],
      admissible_routes: ['r_1'],
      selected_route_id: 'r_1',
      route_snapshot: {
        route_id: 'r_1',
        route_type: 'provider' as const,
        connection_id: 'c_1',
        source_id: 'm_1',
        source_provider: 'non_existent_provider',
        pricing: {
          input_cost_per_1k_tokens: 0,
          output_cost_per_1k_tokens: 0,
          currency: 'USD',
          units: '1k',
          source: 'test',
          pricing_status: 'known_free' as const,
          effective_at: new Date(),
          refreshed_at: new Date(),
          version: '1',
        },
        policy_version: 1,
      },
      rejection_reasons: [],
      estimated_cost: 0,
      decided_at: new Date(),
    };

    const mockAttempt = {
      attempt_id: 'att_1',
      account_id: 'acc_1',
      execution_id: 'exec_1',
      task_id: 't_1',
      decision_id: 'd_1',
      idempotency_key: 'idem_1',
      status: 'running' as const,
      started_at: new Date(),
      completed_at: null,
      cancel_requested_at: null,
      cancelled_at: null,
      retry_count: 0,
      retry_policy: null,
      parent_attempt_id: null,
      verification_outcome: null,
      failure_code: null,
      created_at: new Date(),
    };

    const output = await bridge.execute({
      task: mockTask,
      decision: mockDecision,
      attempt: mockAttempt,
    });

    const verification = await verifier.verify(output, {
      task: mockTask,
      decision: mockDecision,
      attempt: mockAttempt,
    });

    expect(verification.outcome).toBe('terminal_failure');
    expect(verification.failure_code).toBe('unknown_adapter');
  });
});
