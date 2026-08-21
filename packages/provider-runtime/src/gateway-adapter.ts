import type { ConnectionRepository } from '@gptrouter/contracts';
import type {
  ExecutionCancellationResult,
  ProviderAdapter,
  ProviderErrorClassification,
  ProviderExecutionRequest,
  ProviderExecutionResult,
} from '@gptrouter/domain';
import type { CredentialResolver } from '@gptrouter/domain';
import { GatewayDispatchError, SafeGatewayDispatcher } from '@gptrouter/security';

export interface GatewayAdapterOptions {
  gatewayType: string;
  connections: Pick<ConnectionRepository, 'getConnection'>;
  credentialResolver: CredentialResolver;
  dispatcher: SafeGatewayDispatcher;
}

/**
 * Provider-neutral gateway adapter. The URL is resolved from the persisted
 * GatewayConnection and every request goes through SafeGatewayDispatcher.
 */
export class GatewayProviderAdapter implements ProviderAdapter {
  readonly provider: string;

  constructor(private readonly options: GatewayAdapterOptions) {
    this.provider = options.gatewayType;
  }

  async execute(request: ProviderExecutionRequest): Promise<ProviderExecutionResult> {
    const connection = await this.options.connections.getConnection(request.connection_id);
    if (!connection || connection.type !== 'gateway' || connection.gateway_type !== this.provider) {
      return failure(request, 'authorization_failed', 'Gateway connection is unavailable', false);
    }

    let credential: string;
    try {
      credential = await this.options.credentialResolver.resolveCredential(request.connection_id);
    } catch {
      return failure(request, 'credential_missing', 'Gateway credential is unavailable', false);
    }

    const body = JSON.stringify({
      model: request.source_id,
      messages: buildMessages(request.task_input),
      stream: false,
    });

    try {
      const response = await this.options.dispatcher.dispatch({
        url: connection.gateway_url,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${credential}`,
        },
        body,
      });
      const parsed = parseJson(response.body);
      if (response.status < 200 || response.status >= 300) {
        const normalized = classifyGatewayStatus(response.status, parsed);
        return failure(
          request,
          normalized.classification,
          normalized.message,
          normalized.retryable,
          extractRequestId(response.headers)
        );
      }
      const usage = extractUsage(parsed);
      return {
        success: true,
        output: { content: extractContent(parsed) },
        provider: this.provider,
        source_id: request.source_id,
        route_id: request.route_id,
        connection_id: request.connection_id,
        provider_request_id: extractRequestId(response.headers),
        is_retryable: false,
        tokens_used: usage,
        actual_cost: null,
        cost_breakdown: { source: 'gateway', cost: 'unknown' },
      };
    } catch (error: unknown) {
      const classification =
        error instanceof GatewayDispatchError && error.code === 'timeout'
          ? 'timeout'
          : 'provider_unavailable';
      return failure(request, classification, 'Gateway request failed', true);
    }
  }

  async cancel(): Promise<ExecutionCancellationResult> {
    return 'not_supported';
  }
}

function failure(
  request: ProviderExecutionRequest,
  classification: ProviderErrorClassification,
  message: string,
  retryable: boolean,
  providerRequestId?: string
): ProviderExecutionResult {
  return {
    success: false,
    output: null,
    provider: request.provider,
    source_id: request.source_id,
    route_id: request.route_id,
    connection_id: request.connection_id,
    provider_request_id: providerRequestId,
    error_classification: classification,
    error_message: message,
    is_retryable: retryable,
    tokens_used: null,
    actual_cost: null,
    cost_breakdown: { error: classification },
  };
}

function buildMessages(input: Record<string, unknown>): Array<{ role: string; content: string }> {
  const messages: Array<{ role: string; content: string }> = [];
  if (typeof input.system_prompt === 'string')
    messages.push({ role: 'system', content: input.system_prompt });
  const user = input.message ?? input.prompt ?? input.description;
  messages.push({ role: 'user', content: typeof user === 'string' ? user : JSON.stringify(input) });
  return messages;
}

function parseJson(body: Uint8Array): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(body));
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function extractContent(body: Record<string, unknown>): string {
  const choices = body.choices;
  if (!Array.isArray(choices) || choices.length === 0) return '';
  const first: unknown = choices[0];
  if (!first || typeof first !== 'object') return '';
  const message = (first as Record<string, unknown>).message;
  if (!message || typeof message !== 'object') return '';
  const content = (message as Record<string, unknown>).content;
  return typeof content === 'string' ? content : '';
}

function extractUsage(body: Record<string, unknown>): { input: number; output: number } | null {
  const usage = body.usage;
  if (!usage || typeof usage !== 'object') return null;
  const value = usage as Record<string, unknown>;
  return typeof value.prompt_tokens === 'number' && typeof value.completion_tokens === 'number'
    ? { input: value.prompt_tokens, output: value.completion_tokens }
    : null;
}

function classifyGatewayStatus(
  status: number,
  body: Record<string, unknown>
): {
  classification: ProviderErrorClassification;
  retryable: boolean;
  message: string;
} {
  const error = body.error;
  const message =
    error &&
    typeof error === 'object' &&
    typeof (error as Record<string, unknown>).message === 'string'
      ? ((error as Record<string, unknown>).message as string)
      : `Gateway HTTP ${status}`;
  if (status === 401) return { classification: 'authentication_failed', retryable: false, message };
  if (status === 403) return { classification: 'authorization_failed', retryable: false, message };
  if (status === 408) return { classification: 'timeout', retryable: true, message };
  if (status === 429) return { classification: 'rate_limited', retryable: true, message };
  if (status >= 500) return { classification: 'provider_unavailable', retryable: true, message };
  return { classification: 'invalid_request', retryable: false, message };
}

function extractRequestId(headers: Record<string, string>): string | undefined {
  return headers['x-request-id'] ?? headers['x-request-id'.toLowerCase()];
}
