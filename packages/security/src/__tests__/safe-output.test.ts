import { describe, expect, it } from 'vitest';
import type { GatewayConnection, ProviderConnection } from '@gptrouter/contracts';
import {
  isForbiddenPublicKey,
  projectPublicConnection,
  sanitizeForPublicOutput,
} from '../safe-output.js';

const NOW = new Date('2026-08-20T00:00:00.000Z');

describe('safe public output boundary', () => {
  it.each([
    'authorization',
    'Authorization',
    'api_key',
    'api-key',
    'client_secret',
    'access_token',
    'refreshToken',
    'credential_reference',
    'vault_path',
    'cookie',
  ])('recognizes forbidden key variant %s', (key) => {
    expect(isForbiddenPublicKey(key)).toBe(true);
  });

  it('does not over-redact benign token usage metadata', () => {
    expect(isForbiddenPublicKey('token_count')).toBe(false);
    expect(isForbiddenPublicKey('input_tokens')).toBe(false);
  });

  it('drops hostile nested secret-like fields by default', () => {
    const value = {
      safe: 'visible',
      token_count: 42,
      Authorization: 'Bearer should-never-leak',
      nested: {
        api_key: 'sk-secret',
        connection_id: 'conn-1',
        deeper: [{ vault_path: '/internal/vault/secret', status: 'ok' }],
      },
    };

    expect(sanitizeForPublicOutput(value)).toEqual({
      safe: 'visible',
      token_count: 42,
      nested: {
        connection_id: 'conn-1',
        deeper: [{ status: 'ok' }],
      },
    });
  });

  it('can redact instead of dropping keys for controlled logs', () => {
    expect(
      sanitizeForPublicOutput(
        { password: 'secret', nested: { access_token: 'secret', status: 'ok' } },
        { mode: 'redact' }
      )
    ).toEqual({
      password: '[REDACTED]',
      nested: { access_token: '[REDACTED]', status: 'ok' },
    });
  });

  it('handles circular values without serializing arbitrary object internals', () => {
    const value: Record<string, unknown> = { safe: true };
    value.self = value;
    expect(sanitizeForPublicOutput(value)).toEqual({ safe: true, self: '[CIRCULAR]' });
  });

  it('projects provider connections without credential references or account ownership internals', () => {
    const connection: ProviderConnection = {
      type: 'provider',
      connection_id: 'conn-provider',
      account_id: 'account-secret-boundary',
      provider: 'example-provider',
      status: 'active',
      credential_reference: 'vault://should-not-leak',
      created_at: NOW,
      updated_at: NOW,
    };

    const projected = projectPublicConnection(connection);
    expect(projected).toEqual({
      type: 'provider',
      connection_id: 'conn-provider',
      provider: 'example-provider',
      status: 'active',
    });
    expect(JSON.stringify(projected)).not.toContain('vault');
    expect(JSON.stringify(projected)).not.toContain('account-secret-boundary');
  });

  it('projects only gateway origin, never credential reference or sensitive path/query', () => {
    const connection: GatewayConnection = {
      type: 'gateway',
      connection_id: 'conn-gateway',
      account_id: 'account-1',
      gateway_type: 'example-gateway',
      gateway_url: 'https://gateway.example.com/private/path?tenant=secret',
      status: 'active',
      credential_reference: '/vault/internal/gateway-token',
      created_at: NOW,
      updated_at: NOW,
    };

    const projected = projectPublicConnection(connection);
    expect(projected).toEqual({
      type: 'gateway',
      connection_id: 'conn-gateway',
      gateway_type: 'example-gateway',
      gateway_origin: 'https://gateway.example.com',
      status: 'active',
    });
    const serialized = JSON.stringify(projected);
    expect(serialized).not.toContain('/private/path');
    expect(serialized).not.toContain('tenant=secret');
    expect(serialized).not.toContain('vault');
  });
});
