/**
 * Native Gemini adapter using Google's generativelanguage API.
 * Translates GPTRouter contracts to Gemini-native request/response format.
 *
 * Security: credentials resolved server-side only via CredentialResolver.
 * No arbitrary URL execution; endpoint comes from trusted provider config.
 */

import type {
  ProviderAdapter,
  ProviderExecutionRequest,
  ProviderExecutionResult,
  ProviderErrorClassification,
  CredentialResolver,
} from './provider-adapter.js';
import type { ExecutionCancellationResult } from './execution-coordinator.js';

export interface GeminiAdapterOptions {
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  timeout_ms?: number;
  credentialResolver: CredentialResolver;
}

function classifyGeminiError(
  status: number,
  body: Record<string, unknown>
): {
  classification: ProviderErrorClassification;
  retryable: boolean;
} {
  const errorObj = body.error as Record<string, unknown> | undefined;
  const code = typeof errorObj?.code === 'number' ? errorObj.code : status;
  const message = typeof errorObj?.message === 'string' ? errorObj.message : '';

  if (code === 429) return { classification: 'rate_limited', retryable: true };
  if (code === 408 || message.toLowerCase().includes('timeout'))
    return { classification: 'timeout', retryable: true };
  if (code >= 500) return { classification: 'provider_unavailable', retryable: true };
  if (code === 401 || code === 403) {
    return {
      classification: code === 401 ? 'authentication_failed' : 'authorization_failed',
      retryable: false,
    };
  }
  if (code === 400) return { classification: 'invalid_request', retryable: false };
  return { classification: 'unknown_provider_error', retryable: false };
}

export class GeminiAdapter implements ProviderAdapter {
  readonly provider = 'google';
  private readonly baseUrl: string;
  private readonly fetchFn: typeof globalThis.fetch;
  private readonly timeout_ms: number;
  private readonly credentialResolver: CredentialResolver;

  constructor(options: GeminiAdapterOptions) {
    this.baseUrl = options.baseUrl ?? 'https://generativelanguage.googleapis.com';
    this.fetchFn = options.fetch ?? globalThis.fetch;
    this.timeout_ms = options.timeout_ms ?? 60_000;
    this.credentialResolver = options.credentialResolver;
  }

  async execute(request: ProviderExecutionRequest): Promise<ProviderExecutionResult> {
    let apiKey: string;
    try {
      apiKey = await this.credentialResolver.resolveCredential(request.connection_id);
    } catch {
      return {
        success: false,
        output: null,
        provider: this.provider,
        source_id: request.source_id,
        route_id: request.route_id,
        connection_id: request.connection_id,
        error_classification: 'credential_missing',
        error_message: 'No credential resolved for Gemini adapter',
        is_retryable: false,
        tokens_used: null,
        actual_cost: 0,
        cost_breakdown: { error: 'missing_credential' },
      };
    }

    const url = `${this.baseUrl}/v1beta/models/${request.source_id}:generateContent`;
    const { systemInstruction, contents } = translateToGeminiFormat(request.task_input);

    const body: Record<string, unknown> = { contents };
    if (systemInstruction) {
      body.system_instruction = { parts: [{ text: systemInstruction }] };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout_ms);

    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error: unknown) {
      clearTimeout(timer);
      const isAbort = error instanceof DOMException && error.name === 'AbortError';
      return {
        success: false,
        output: null,
        provider: this.provider,
        source_id: request.source_id,
        route_id: request.route_id,
        connection_id: request.connection_id,
        error_classification: isAbort ? 'timeout' : 'provider_unavailable',
        error_message: isAbort
          ? 'Request timed out'
          : `Network error: ${error instanceof Error ? error.message : 'unknown'}`,
        is_retryable: true,
        tokens_used: null,
        actual_cost: null,
        cost_breakdown: { error: isAbort ? 'timeout' : 'network' },
      };
    } finally {
      clearTimeout(timer);
    }

    const responseBody = (await response.json()) as Record<string, unknown>;

    if (!response.ok) {
      const { classification, retryable } = classifyGeminiError(response.status, responseBody);
      const errorObj = responseBody.error as Record<string, unknown> | undefined;
      return {
        success: false,
        output: null,
        provider: this.provider,
        source_id: request.source_id,
        route_id: request.route_id,
        connection_id: request.connection_id,
        error_classification: classification,
        error_message:
          typeof errorObj?.message === 'string' ? errorObj.message : `HTTP ${response.status}`,
        is_retryable: retryable,
        tokens_used: extractGeminiUsage(responseBody),
        actual_cost: null,
        cost_breakdown: { error: classification },
      };
    }

    const content = extractGeminiContent(responseBody);
    const usage = extractGeminiUsage(responseBody);

    return {
      success: true,
      output: { content },
      provider: this.provider,
      source_id: request.source_id,
      route_id: request.route_id,
      connection_id: request.connection_id,
      is_retryable: false,
      tokens_used: usage,
      actual_cost: null,
      cost_breakdown: { provider: 'google', actual_cost: null },
    };
  }

  async cancel(): Promise<ExecutionCancellationResult> {
    return 'not_supported';
  }
}

function translateToGeminiFormat(taskInput: Record<string, unknown>): {
  systemInstruction: string | null;
  contents: Array<{ role: string; parts: Array<{ text: string }> }>;
} {
  const systemInstruction =
    typeof taskInput.system_prompt === 'string' ? taskInput.system_prompt : null;
  const userMessage =
    typeof taskInput.message === 'string'
      ? taskInput.message
      : typeof taskInput.prompt === 'string'
        ? taskInput.prompt
        : typeof taskInput.description === 'string'
          ? taskInput.description
          : JSON.stringify(taskInput);

  return {
    systemInstruction,
    contents: [{ role: 'user', parts: [{ text: userMessage }] }],
  };
}

function extractGeminiContent(body: Record<string, unknown>): string {
  const candidates = body.candidates as Array<Record<string, unknown>> | undefined;
  if (!candidates || candidates.length === 0) return '';
  const firstCandidate = candidates[0];
  const content = firstCandidate?.content as Record<string, unknown> | undefined;
  const parts = content?.parts as Array<Record<string, unknown>> | undefined;
  if (!parts || parts.length === 0) return '';
  return typeof parts[0].text === 'string' ? parts[0].text : '';
}

function extractGeminiUsage(
  body: Record<string, unknown>
): { input: number; output: number } | null {
  const usageMetadata = body.usageMetadata as Record<string, unknown> | undefined;
  if (!usageMetadata) return null;
  const inputTokens =
    typeof usageMetadata.promptTokenCount === 'number' ? usageMetadata.promptTokenCount : 0;
  const outputTokens =
    typeof usageMetadata.candidatesTokenCount === 'number' ? usageMetadata.candidatesTokenCount : 0;
  return { input: inputTokens, output: outputTokens };
}
