/**
 * OpenAI-compatible execution adapter for OpenRouter, DeepSeek, and
 * any provider exposing an OpenAI-compatible /v1/chat/completions endpoint.
 *
 * Security: credentials are resolved server-side only via CredentialResolver.
 * Endpoint selection comes from trusted server-side provider configuration.
 * No arbitrary URL execution is exposed through MCP.
 */

import type {
  ProviderAdapter,
  ProviderExecutionRequest,
  ProviderExecutionResult,
  ProviderErrorClassification,
  CredentialResolver,
} from './provider-adapter.js';
import type { ExecutionCancellationResult } from './execution-coordinator.js';

export interface OpenAICompatibleAdapterOptions {
  provider: string;
  baseUrl: string; // Trusted server-side configured endpoint
  fetch?: typeof globalThis.fetch;
  timeout_ms?: number;
  credentialResolver: CredentialResolver;
}

function classifyOpenAIError(
  status: number,
  body: Record<string, unknown>
): {
  classification: ProviderErrorClassification;
  retryable: boolean;
} {
  const errorObj = body.error as Record<string, unknown> | undefined;
  const message = typeof errorObj?.message === 'string' ? errorObj.message : '';

  if (status === 429) {
    return { classification: 'rate_limited', retryable: true };
  }
  if (status === 408 || message.toLowerCase().includes('timeout')) {
    return { classification: 'timeout', retryable: true };
  }
  if (status === 503 || status === 502 || status === 500) {
    return { classification: 'provider_unavailable', retryable: true };
  }
  if (status === 401 || status === 403) {
    const isAuth = status === 401;
    return {
      classification: isAuth ? 'authentication_failed' : 'authorization_failed',
      retryable: false,
    };
  }
  if (status === 400) {
    const msgLower = message.toLowerCase();
    if (msgLower.includes('context') || msgLower.includes('token') || msgLower.includes('length')) {
      return { classification: 'context_limit', retryable: false };
    }
    return { classification: 'invalid_request', retryable: false };
  }
  if (status === 402) {
    return { classification: 'insufficient_balance', retryable: false };
  }
  return { classification: 'unknown_provider_error', retryable: false };
}

export class OpenAICompatibleAdapter implements ProviderAdapter {
  readonly provider: string;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof globalThis.fetch;
  private readonly timeout_ms: number;
  private readonly credentialResolver: CredentialResolver;

  constructor(options: OpenAICompatibleAdapterOptions) {
    this.provider = options.provider;
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.fetchFn = options.fetch ?? globalThis.fetch;
    this.timeout_ms = options.timeout_ms ?? 60_000;
    this.credentialResolver = options.credentialResolver;
  }

  async execute(request: ProviderExecutionRequest): Promise<ProviderExecutionResult> {
    let credential: string;
    try {
      credential = await this.credentialResolver.resolveCredential(request.connection_id);
    } catch {
      return {
        success: false,
        output: null,
        provider: this.provider,
        source_id: request.source_id,
        route_id: request.route_id,
        connection_id: request.connection_id,
        error_classification: 'credential_missing',
        error_message: 'Could not resolve credential',
        is_retryable: false,
        tokens_used: null,
        actual_cost: null,
        cost_breakdown: { error: 'credential_missing' },
      };
    }

    const url = `${this.baseUrl}/v1/chat/completions`;
    const messages = buildMessages(request.task_input);

    const body = {
      model: request.source_id,
      messages,
      stream: false,
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout_ms);

    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${credential}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error: unknown) {
      clearTimeout(timer);
      const isAbort = error instanceof DOMException && error.name === 'AbortError';
      if (isAbort) {
        return {
          success: false,
          output: null,
          provider: this.provider,
          source_id: request.source_id,
          route_id: request.route_id,
          connection_id: request.connection_id,
          error_classification: 'timeout',
          error_message: 'Request timed out',
          is_retryable: true,
          tokens_used: null,
          actual_cost: null,
          cost_breakdown: { error: 'timeout' },
        };
      }
      return {
        success: false,
        output: null,
        provider: this.provider,
        source_id: request.source_id,
        route_id: request.route_id,
        connection_id: request.connection_id,
        error_classification: 'provider_unavailable',
        error_message: `Network error: ${error instanceof Error ? error.message : 'unknown'}`,
        is_retryable: true,
        tokens_used: null,
        actual_cost: null,
        cost_breakdown: { error: 'network' },
      };
    } finally {
      clearTimeout(timer);
    }

    const responseBody = (await response.json()) as Record<string, unknown>;

    if (!response.ok) {
      const { classification, retryable } = classifyOpenAIError(response.status, responseBody);
      const errorObj = responseBody.error as Record<string, unknown> | undefined;
      const message =
        typeof errorObj?.message === 'string' ? errorObj.message : `HTTP ${response.status}`;

      return {
        success: false,
        output: null,
        provider: this.provider,
        source_id: request.source_id,
        route_id: request.route_id,
        connection_id: request.connection_id,
        provider_request_id: response.headers.get('x-request-id') ?? undefined,
        error_classification: classification,
        error_message: message,
        is_retryable: retryable,
        tokens_used: extractUsage(responseBody),
        actual_cost: null,
        cost_breakdown: { error: classification },
      };
    }

    const outputText = extractContent(responseBody);
    const usage = extractUsage(responseBody);
    const cost = estimateCost(request.source_id, usage);
    const finishReason = extractFinishReason(responseBody);

    // Normalized, bounded output — no raw response blob
    const output: Record<string, unknown> = { content: outputText };
    if (finishReason) output.finish_reason = finishReason;
    const toolCalls = extractToolCalls(responseBody);
    if (toolCalls) output.tool_calls = toolCalls;

    return {
      success: true,
      output,
      provider: this.provider,
      source_id: request.source_id,
      route_id: request.route_id,
      connection_id: request.connection_id,
      provider_request_id: response.headers.get('x-request-id') ?? undefined,
      is_retryable: false,
      tokens_used: usage,
      actual_cost: cost.known ? cost.total : null,
      cost_breakdown: cost.known
        ? {
            provider: this.provider,
            input_cost: cost.input,
            output_cost: cost.output,
            cost_known: true,
          }
        : { provider: this.provider, cost_known: false },
    };
  }

  async cancel(
    _connection_id: string,
    _provider_request_id: string
  ): Promise<ExecutionCancellationResult> {
    return 'not_supported';
  }
}

function buildMessages(
  taskInput: Record<string, unknown>
): Array<{ role: string; content: string }> {
  const messages: Array<{ role: string; content: string }> = [];

  const systemPrompt = taskInput.system_prompt ?? taskInput.system;
  if (typeof systemPrompt === 'string') {
    messages.push({ role: 'system', content: systemPrompt });
  }

  const userMessage = taskInput.message ?? taskInput.prompt ?? taskInput.description;
  if (typeof userMessage === 'string') {
    messages.push({ role: 'user', content: userMessage });
  }

  if (messages.length === 0) {
    messages.push({ role: 'user', content: JSON.stringify(taskInput) });
  }

  return messages;
}

function extractContent(body: Record<string, unknown>): string {
  const choices = body.choices as Array<Record<string, unknown>> | undefined;
  if (!choices || choices.length === 0) return '';
  const firstChoice = choices[0];
  const message = firstChoice?.message as Record<string, unknown> | undefined;
  return typeof message?.content === 'string' ? message.content : '';
}

function extractFinishReason(body: Record<string, unknown>): string | null {
  const choices = body.choices as Array<Record<string, unknown>> | undefined;
  if (!choices || choices.length === 0) return null;
  const reason = choices[0]?.finish_reason;
  return typeof reason === 'string' ? reason : null;
}

function extractToolCalls(body: Record<string, unknown>): Array<Record<string, unknown>> | null {
  const choices = body.choices as Array<Record<string, unknown>> | undefined;
  if (!choices || choices.length === 0) return null;
  const message = choices[0]?.message as Record<string, unknown> | undefined;
  const toolCalls = message?.tool_calls;
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) return null;
  // Normalize to bounded structure
  return toolCalls.map((tc: Record<string, unknown>) => ({
    id: tc.id,
    type: tc.type,
    function: tc.function,
  }));
}

function extractUsage(body: Record<string, unknown>): { input: number; output: number } | null {
  const usage = body.usage as Record<string, unknown> | undefined;
  if (!usage) return null;
  const inputTokens = typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : 0;
  const outputTokens = typeof usage.completion_tokens === 'number' ? usage.completion_tokens : 0;
  return { input: inputTokens, output: outputTokens };
}

function estimateCost(
  model: string,
  usage: { input: number; output: number } | null
): { total: number; input: number; output: number; known: boolean } {
  if (!usage) return { total: 0, input: 0, output: 0, known: false };

  const pricing = MODEL_PRICING[model];
  if (!pricing) {
    // Unknown model: cost is unknown, NOT zero
    return { total: 0, input: 0, output: 0, known: false };
  }

  const inputCost = (usage.input / 1000) * pricing.input;
  const outputCost = (usage.output / 1000) * pricing.output;

  return {
    total: inputCost + outputCost,
    input: inputCost,
    output: outputCost,
    known: true,
  };
}

// Pricing data with explicit provenance.
// NOT hardcoded as canonical truth — this is a reference snapshot.
const MODEL_PRICING: Record<string, { input: number; output: number; source?: string }> = {};

export function registerModelPricing(
  model: string,
  input: number,
  output: number,
  source?: string
): void {
  MODEL_PRICING[model] = { input, output, source };
}

export function clearModelPricing(): void {
  Object.keys(MODEL_PRICING).forEach((key) => delete MODEL_PRICING[key]);
}
