import type {
  ExecutionCancellationInput,
  ExecutionCancellationResult,
  ExecutionInput,
  ExecutionOutput,
  ExecutionExecutor,
  ExecutionVerifier,
} from './execution-coordinator.js';

export interface ProviderExecutionRequest {
  connection_id: string; // Opaque reference ONLY
  provider: string; // e.g. 'openai', 'anthropic', 'google', 'openrouter', '9router'
  route_id: string;
  source_id: string; // Model identifier, e.g. 'gpt-4o'
  route_type: 'provider' | 'gateway';
  gateway_url?: string;
  task_input: Record<string, unknown>;
}

export type ProviderErrorClassification =
  | 'rate_limited'
  | 'timeout'
  | 'provider_unavailable'
  | 'invalid_request'
  | 'authentication_failed'
  | 'authorization_failed'
  | 'cancelled'
  | 'unknown_provider_error';

export interface ProviderExecutionResult {
  success: boolean;
  output: Record<string, unknown> | null;
  provider: string;
  source_id: string;
  route_id: string;
  connection_id: string; // Opaque reference, NEVER credential
  provider_request_id?: string;
  error_classification?: ProviderErrorClassification;
  error_message?: string;
  is_retryable: boolean;
  tokens_used: {
    input: number;
    output: number;
  } | null;
  actual_cost: number;
  cost_breakdown: Record<string, unknown>;
}

export interface ProviderAdapter {
  readonly provider: string; // e.g. 'openai', 'anthropic', 'fake' or '*'
  execute(request: ProviderExecutionRequest): Promise<ProviderExecutionResult>;
  cancel?(connection_id: string, provider_request_id: string): Promise<ExecutionCancellationResult>;
}

export interface ProviderAdapterRegistry {
  getAdapter(provider: string, route_type?: 'provider' | 'gateway'): ProviderAdapter | null;
}

export interface FakeProviderAdapterOptions {
  provider?: string;
  outcome?:
    | 'success'
    | 'retryable_failure'
    | 'terminal_failure'
    | 'timeout'
    | 'rate_limit'
    | 'unavailable'
    | 'hold';
  failure_classification?: ProviderErrorClassification;
  failure_message?: string;
  tokens_used?: { input: number; output: number };
  synthetic_cost?: number;
  cancellation_supported?: boolean;
}

export class FakeProviderAdapter implements ProviderAdapter {
  readonly provider: string;
  private invocations = 0;
  private readonly pending = new Map<
    string,
    { resolve: (res: ProviderExecutionResult) => void; reject: (err: Error) => void }
  >();

  constructor(private readonly options: FakeProviderAdapterOptions = {}) {
    this.provider = options.provider ?? 'fake_provider';
  }

  get invocationCount(): number {
    return this.invocations;
  }

  async execute(request: ProviderExecutionRequest): Promise<ProviderExecutionResult> {
    this.invocations += 1;
    const outcome = this.options.outcome ?? 'success';

    // Verify credential or raw secrets are NOT present
    if ('api_key' in request || 'secret' in request || 'access_token' in request) {
      throw new Error('SECURITY_VIOLATION: Raw credential passed in execution request');
    }

    if (outcome === 'hold') {
      return await new Promise<ProviderExecutionResult>((resolve, reject) => {
        this.pending.set(request.connection_id, { resolve, reject });
      });
    }

    if (outcome === 'success') {
      return {
        success: true,
        output: { result: 'synthetic_fake_adapter_success', input_received: true },
        provider: request.provider,
        source_id: request.source_id,
        route_id: request.route_id,
        connection_id: request.connection_id,
        provider_request_id: `fake_req_${this.invocations}`,
        is_retryable: false,
        tokens_used: this.options.tokens_used ?? { input: 10, output: 20 },
        actual_cost: this.options.synthetic_cost ?? 0,
        cost_breakdown: { synthetic_cost: this.options.synthetic_cost ?? 0 },
      };
    }

    let classification: ProviderErrorClassification = 'unknown_provider_error';
    let isRetryable = false;

    if (outcome === 'retryable_failure') {
      classification = this.options.failure_classification ?? 'provider_unavailable';
      isRetryable = true;
    } else if (outcome === 'timeout') {
      classification = 'timeout';
      isRetryable = true;
    } else if (outcome === 'rate_limit') {
      classification = 'rate_limited';
      isRetryable = true;
    } else if (outcome === 'unavailable') {
      classification = 'provider_unavailable';
      isRetryable = true;
    } else {
      // terminal_failure or unknown
      classification = this.options.failure_classification ?? 'invalid_request';
      isRetryable = false;
    }

    return {
      success: false,
      output: null,
      provider: request.provider,
      source_id: request.source_id,
      route_id: request.route_id,
      connection_id: request.connection_id,
      provider_request_id: `fake_req_${this.invocations}`,
      error_classification: classification,
      error_message: this.options.failure_message ?? `Fake adapter error: ${classification}`,
      is_retryable: isRetryable,
      tokens_used: this.options.tokens_used ?? null,
      actual_cost: 0,
      cost_breakdown: { actual_cost: 0 },
    };
  }

  async cancel(
    connection_id: string,
    _provider_request_id: string
  ): Promise<ExecutionCancellationResult> {
    if (!this.options.cancellation_supported || !this.pending.has(connection_id)) {
      return 'not_supported';
    }
    const pending = this.pending.get(connection_id);
    this.pending.delete(connection_id);
    pending?.reject(new Error('synthetic_fake_adapter_cancelled'));
    return 'cancelled';
  }
}

export class DefaultProviderAdapterRegistry implements ProviderAdapterRegistry {
  private readonly adapters = new Map<string, ProviderAdapter>();
  private defaultAdapter: ProviderAdapter | null = null;

  registerAdapter(provider: string, adapter: ProviderAdapter): void {
    this.adapters.set(provider.toLowerCase(), adapter);
  }

  setDefaultAdapter(adapter: ProviderAdapter): void {
    this.defaultAdapter = adapter;
  }

  getAdapter(provider: string, _route_type?: 'provider' | 'gateway'): ProviderAdapter | null {
    const key = provider.toLowerCase();
    return this.adapters.get(key) ?? this.defaultAdapter ?? null;
  }
}

export interface AdapterExecutionCoordinatorBridgeOptions {
  registry: ProviderAdapterRegistry;
}

export class AdapterExecutionCoordinatorBridge implements ExecutionExecutor {
  constructor(private readonly options: AdapterExecutionCoordinatorBridgeOptions) {}

  async execute(input: ExecutionInput): Promise<ExecutionOutput> {
    const snapshot = input.decision.route_snapshot;
    if (!snapshot) {
      throw new Error('route_snapshot_missing');
    }

    const provider = snapshot.source_provider ?? snapshot.source_gateway ?? 'unknown';
    const adapter = this.options.registry.getAdapter(provider, snapshot.route_type);

    if (!adapter) {
      // Unknown adapter fails closed with a retryable or terminal error represented in result
      return {
        provider_usage_data: {
          execution_mode: 'fake_adapter',
          error: 'unknown_adapter',
          provider,
        },
        actual_cost: 0,
        cost_breakdown: { error: 'unknown_adapter' },
        tokens_used: null,
      };
    }

    const request: ProviderExecutionRequest = {
      connection_id: snapshot.connection_id,
      provider,
      route_id: snapshot.route_id,
      source_id: snapshot.source_id,
      route_type: snapshot.route_type,
      task_input: input.task.requirements.context ?? { description: input.task.description },
    };

    const result = await adapter.execute(request);

    if (!result.success) {
      return {
        provider_usage_data: {
          execution_mode: 'fake_adapter',
          success: false,
          error_classification: result.error_classification ?? 'unknown_provider_error',
          error_message: result.error_message,
          is_retryable: result.is_retryable,
          provider: result.provider,
          source_id: result.source_id,
          route_id: result.route_id,
          connection_id: result.connection_id,
        },
        actual_cost: result.actual_cost,
        cost_breakdown: result.cost_breakdown,
        tokens_used: result.tokens_used,
      };
    }

    return {
      provider_usage_data: {
        execution_mode: 'fake_adapter',
        success: true,
        output: result.output,
        provider: result.provider,
        source_id: result.source_id,
        route_id: result.route_id,
        connection_id: result.connection_id,
        provider_request_id: result.provider_request_id,
      },
      actual_cost: result.actual_cost,
      cost_breakdown: result.cost_breakdown,
      tokens_used: result.tokens_used,
    };
  }

  async cancel(input: ExecutionCancellationInput): Promise<ExecutionCancellationResult> {
    const snapshot = input.decision.route_snapshot;
    if (!snapshot) return 'not_supported';
    const provider = snapshot.source_provider ?? snapshot.source_gateway ?? 'unknown';
    const adapter = this.options.registry.getAdapter(provider, snapshot.route_type);
    if (!adapter || !adapter.cancel) return 'not_supported';

    return adapter.cancel(snapshot.connection_id, input.attempt.attempt_id);
  }
}

export class AdapterExecutionVerifier implements ExecutionVerifier {
  async verify(output: ExecutionOutput, _input: ExecutionInput) {
    const data = output.provider_usage_data;
    if (data && data.execution_mode === 'fake_adapter') {
      if (data.error === 'unknown_adapter') {
        return {
          outcome: 'terminal_failure' as const,
          failure_code: 'unknown_adapter',
        };
      }
      if (data.success === false) {
        const isRetryable = data.is_retryable === true;
        const code = (data.error_classification as string) || 'provider_error';
        return {
          outcome: isRetryable ? ('retryable_failure' as const) : ('terminal_failure' as const),
          failure_code: code,
        };
      }
    }
    return { outcome: 'accepted' as const };
  }
}
