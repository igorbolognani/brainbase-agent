import { describe, it, expect } from 'vitest';
import { getTrustedEndpoint, TRUSTED_PROVIDER_ENDPOINTS } from '../provider-endpoint-registry.js';

describe('Provider Endpoint Registry', () => {
  it('has trusted endpoints for known providers', () => {
    expect(TRUSTED_PROVIDER_ENDPOINTS.length).toBeGreaterThanOrEqual(3);
  });

  it('returns google endpoint', () => {
    const ep = getTrustedEndpoint('google');
    expect(ep).not.toBeNull();
    expect(ep!.baseUrl).toBe('https://generativelanguage.googleapis.com');
    expect(ep!.auth_method).toBe('api_key_header');
  });

  it('returns openrouter endpoint', () => {
    const ep = getTrustedEndpoint('openrouter');
    expect(ep).not.toBeNull();
    expect(ep!.auth_method).toBe('bearer');
  });

  it('returns deepseek endpoint', () => {
    const ep = getTrustedEndpoint('deepseek');
    expect(ep).not.toBeNull();
  });

  it('returns null for unknown provider', () => {
    expect(getTrustedEndpoint('nonexistent')).toBeNull();
  });
});
