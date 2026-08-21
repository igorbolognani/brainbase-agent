import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  OpenAICompatibleAdapter,
  registerModelPricing,
  clearModelPricing,
} from '../openai-adapter.js';
import { GeminiAdapter } from '../gemini-adapter.js';
import { ProviderHealthTracker } from '../provider-health.js';
import type { ProviderExecutionRequest } from '../provider-adapter.js';

function makeRequest(overrides: Partial<ProviderExecutionRequest> = {}): ProviderExecutionRequest {
  return {
    connection_id: 'conn-1',
    provider: 'openrouter',
    route_id: 'route-1',
    source_id: 'gpt-4o',
    route_type: 'provider',
    task_input: { message: 'Hello' },
    _credential: 'test-api-key',
    ...overrides,
  };
}

function mockFetch(
  response: { ok: boolean; status: number; body: unknown; headers?: Record<string, string> }
): typeof globalThis.fetch {
  return vi.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status,
    json: () => Promise.resolve(response.body),
    headers: new Map(Object.entries(response.headers ?? {})),
  } as unknown as Response);
}

// ============================================================================
// OpenAI-Compatible Adapter
// ============================================================================

describe('OpenAICompatibleAdapter', () => {
  let adapter: OpenAICompatibleAdapter;

  beforeEach(() => {
    clearModelPricing();
    adapter = new OpenAICompatibleAdapter({
      provider: 'openrouter',
      baseUrl: 'https://openrouter.ai/api',
      timeout_ms: 5000,
    });
  });

  it('normalizes successful response', async () => {
    const fetch = mockFetch({
      ok: true,
      status: 200,
      body: {
        choices: [{ message: { content: 'Hello back!' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      },
      headers: { 'x-request-id': 'req-123' },
    });
    adapter = new OpenAICompatibleAdapter({
      provider: 'openrouter',
      baseUrl: 'https://openrouter.ai/api',
      fetch,
    });

    const result = await adapter.execute(makeRequest());
    expect(result.success).toBe(true);
    expect(result.output).toEqual({ content: 'Hello back!', raw: expect.any(Object) } as Record<string, unknown>);
    expect(result.tokens_used).toEqual({ input: 10, output: 5 });
    expect(result.provider_request_id).toBe('req-123');
  });

  it('classifies rate limit errors', async () => {
    const fetch = mockFetch({
      ok: false,
      status: 429,
      body: { error: { message: 'Rate limited' } },
    });
    adapter = new OpenAICompatibleAdapter({
      provider: 'openrouter',
      baseUrl: 'https://openrouter.ai/api',
      fetch,
    });

    const result = await adapter.execute(makeRequest());
    expect(result.success).toBe(false);
    expect(result.error_classification).toBe('rate_limited');
    expect(result.is_retryable).toBe(true);
  });

  it('classifies auth failures as terminal', async () => {
    const fetch = mockFetch({
      ok: false,
      status: 401,
      body: { error: { message: 'Invalid API key' } },
    });
    adapter = new OpenAICompatibleAdapter({
      provider: 'openrouter',
      baseUrl: 'https://openrouter.ai/api',
      fetch,
    });

    const result = await adapter.execute(makeRequest());
    expect(result.success).toBe(false);
    expect(result.error_classification).toBe('authentication_failed');
    expect(result.is_retryable).toBe(false);
  });

  it('classifies server errors as retryable', async () => {
    const fetch = mockFetch({
      ok: false,
      status: 500,
      body: { error: { message: 'Internal error' } },
    });
    adapter = new OpenAICompatibleAdapter({
      provider: 'openrouter',
      baseUrl: 'https://openrouter.ai/api',
      fetch,
    });

    const result = await adapter.execute(makeRequest());
    expect(result.success).toBe(false);
    expect(result.error_classification).toBe('provider_unavailable');
    expect(result.is_retryable).toBe(true);
  });

  it('handles timeout', async () => {
    const fetch = vi.fn().mockRejectedValue(
      new DOMException('The operation was aborted', 'AbortError')
    );
    adapter = new OpenAICompatibleAdapter({
      provider: 'openrouter',
      baseUrl: 'https://openrouter.ai/api',
      fetch,
      timeout_ms: 100,
    });

    const result = await adapter.execute(makeRequest());
    expect(result.success).toBe(false);
    expect(result.error_classification).toBe('timeout');
    expect(result.is_retryable).toBe(true);
  });

  it('handles network errors', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    adapter = new OpenAICompatibleAdapter({
      provider: 'openrouter',
      baseUrl: 'https://openrouter.ai/api',
      fetch,
    });

    const result = await adapter.execute(makeRequest());
    expect(result.success).toBe(false);
    expect(result.error_classification).toBe('provider_unavailable');
    expect(result.is_retryable).toBe(true);
  });

  it('estimates cost with known pricing', async () => {
    registerModelPricing('gpt-4o', 0.0025, 0.01);
    const fetch = mockFetch({
      ok: true,
      status: 200,
      body: {
        choices: [{ message: { content: 'done' } }],
        usage: { prompt_tokens: 1000, completion_tokens: 500 },
      },
    });
    adapter = new OpenAICompatibleAdapter({
      provider: 'openrouter',
      baseUrl: 'https://openrouter.ai/api',
      fetch,
    });

    const result = await adapter.execute(makeRequest({ source_id: 'gpt-4o' }));
    expect(result.actual_cost).toBeCloseTo(0.0025 + 0.005, 6);
    expect(result.cost_breakdown).toHaveProperty('input');
    expect(result.cost_breakdown).toHaveProperty('output');
  });

  it('returns zero cost for unknown model (unknown, not fake zero)', async () => {
    const fetch = mockFetch({
      ok: true,
      status: 200,
      body: {
        choices: [{ message: { content: 'done' } }],
        usage: { prompt_tokens: 1000, completion_tokens: 500 },
      },
    });
    adapter = new OpenAICompatibleAdapter({
      provider: 'openrouter',
      baseUrl: 'https://openrouter.ai/api',
      fetch,
    });

    const result = await adapter.execute(makeRequest({ source_id: 'unknown-model' }));
    expect(result.actual_cost).toBe(0);
  });

  it('translates messages correctly', async () => {
    let capturedBody: unknown;
    const fetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return {
        ok: true,
        status: 200,
        json: () => Promise.resolve({ choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 0, completion_tokens: 0 } }),
        headers: new Map(),
      };
    });
    adapter = new OpenAICompatibleAdapter({
      provider: 'openrouter',
      baseUrl: 'https://openrouter.ai/api',
      fetch,
    });

    await adapter.execute(makeRequest({
      task_input: { system_prompt: 'You are helpful', message: 'Hello' },
    }));

    const body = capturedBody as { model: string; messages: Array<{ role: string; content: string }> };
    expect(body.model).toBe('gpt-4o');
    expect(body.messages).toEqual([
      { role: 'system', content: 'You are helpful' },
      { role: 'user', content: 'Hello' },
    ]);
  });

  it('cancel returns not_supported', async () => {
    const result = await adapter.cancel('conn-1', 'req-1');
    expect(result).toBe('not_supported');
  });
});

// ============================================================================
// Gemini Adapter
// ============================================================================

describe('GeminiAdapter', () => {
  let adapter: GeminiAdapter;

  beforeEach(() => {
    adapter = new GeminiAdapter();
  });

  it('translates to Gemini format and normalizes response', async () => {
    let capturedBody: unknown;
    const fetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return {
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          candidates: [{ content: { parts: [{ text: 'Gemini says hello' }] } }],
          usageMetadata: { promptTokenCount: 15, candidatesTokenCount: 8 },
        }),
        headers: new Map(),
      };
    });
    adapter = new GeminiAdapter({ fetch });

    const result = await adapter.execute(makeRequest({
      provider: 'google',
      source_id: 'gemini-pro',
      task_input: { system_prompt: 'Be helpful', message: 'Hi' },
    }));

    expect(result.success).toBe(true);
    expect(result.output).toEqual({ content: 'Gemini says hello', raw: expect.any(Object) } as Record<string, unknown>);
    expect(result.tokens_used).toEqual({ input: 15, output: 8 });

    const body = capturedBody as { contents: unknown[]; system_instruction?: unknown };
    expect(body.system_instruction).toEqual({ parts: [{ text: 'Be helpful' }] });
    expect(body.contents[0]).toEqual({ role: 'user', parts: [{ text: 'Hi' }] });
  });

  it('fails without credential', async () => {
    const result = await adapter.execute(makeRequest({
      provider: 'google',
      _credential: undefined,
    }));
    expect(result.success).toBe(false);
    expect(result.error_classification).toBe('authentication_failed');
    expect(result.is_retryable).toBe(false);
  });

  it('classifies Gemini errors', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: () => Promise.resolve({ error: { code: 429, message: 'Quota exceeded' } }),
      headers: new Map(),
    });
    adapter = new GeminiAdapter({ fetch });

    const result = await adapter.execute(makeRequest({ provider: 'google' }));
    expect(result.success).toBe(false);
    expect(result.error_classification).toBe('rate_limited');
    expect(result.is_retryable).toBe(true);
  });

  it('handles Gemini timeout', async () => {
    const fetch = vi.fn().mockRejectedValue(
      new DOMException('The operation was aborted', 'AbortError')
    );
    adapter = new GeminiAdapter({ fetch });

    const result = await adapter.execute(makeRequest({ provider: 'google' }));
    expect(result.success).toBe(false);
    expect(result.error_classification).toBe('timeout');
  });
});

// ============================================================================
// Provider Health Tracker
// ============================================================================

describe('ProviderHealthTracker', () => {
  let tracker: ProviderHealthTracker;
  let now: Date;

  beforeEach(() => {
    now = new Date('2025-01-01T00:00:00Z');
    tracker = new ProviderHealthTracker({
      degraded_threshold: 2,
      unavailable_threshold: 5,
      clock: () => now,
    });
  });

  it('starts healthy', () => {
    expect(tracker.getHealth('openai')).toBe('healthy');
  });

  it('becomes degraded after threshold failures', () => {
    tracker.recordFailure('openai');
    expect(tracker.getHealth('openai')).toBe('healthy');

    tracker.recordFailure('openai');
    expect(tracker.getHealth('openai')).toBe('degraded');
  });

  it('becomes unavailable after high failure threshold', () => {
    for (let i = 0; i < 5; i++) {
      tracker.recordFailure('openai');
    }
    expect(tracker.getHealth('openai')).toBe('unavailable');
  });

  it('recovers to healthy on success', () => {
    for (let i = 0; i < 3; i++) {
      tracker.recordFailure('openai');
    }
    expect(tracker.getHealth('openai')).toBe('degraded');

    tracker.recordSuccess('openai');
    expect(tracker.getHealth('openai')).toBe('healthy');
  });

  it('tracks per-provider health independently', () => {
    tracker.recordFailure('openai');
    tracker.recordFailure('openai');
    tracker.recordFailure('deepseek');

    expect(tracker.getHealth('openai')).toBe('degraded');
    expect(tracker.getHealth('deepseek')).toBe('healthy');
  });

  it('getEntry returns snapshot', () => {
    tracker.recordSuccess('openai');
    tracker.recordFailure('openai');

    const entry = tracker.getEntry('openai');
    expect(entry.consecutive_failures).toBe(1);
    expect(entry.total_successes).toBe(1);
    expect(entry.total_failures).toBe(1);
    expect(entry.state).toBe('healthy');
  });

  it('reset clears failures', () => {
    for (let i = 0; i < 3; i++) {
      tracker.recordFailure('openai');
    }
    expect(tracker.getHealth('openai')).toBe('degraded');

    tracker.reset('openai');
    expect(tracker.getHealth('openai')).toBe('healthy');
  });

  it('getAllEntries returns all providers', () => {
    tracker.recordSuccess('openai');
    tracker.recordFailure('deepseek');

    const all = tracker.getAllEntries();
    expect(all).toHaveLength(2);
    expect(all.map((e) => e.provider)).toContain('openai');
    expect(all.map((e) => e.provider)).toContain('deepseek');
  });
});
