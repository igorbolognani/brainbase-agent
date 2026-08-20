import { describe, expect, it } from 'vitest';
import {
  hasValidBearerToken,
  isAllowedHost,
  isAllowedOrigin,
  loadHttpServerConfig,
  parseHostHeader,
} from '../http-config.js';

describe('HTTP deployment configuration', () => {
  it('defaults to loopback-only local mode', () => {
    const config = loadHttpServerConfig({});
    expect(config.mode).toBe('local');
    expect(config.host).toBe('127.0.0.1');
    expect(config.port).toBe(3000);
    expect(config.bearerToken).toBeUndefined();
  });

  it('rejects a non-loopback bind in local mode', () => {
    expect(() => loadHttpServerConfig({ HOST: '0.0.0.0' })).toThrow(/Local mode/);
  });

  it('fails closed when remote security configuration is incomplete', () => {
    expect(() =>
      loadHttpServerConfig({
        GPTROUTER_HTTP_MODE: 'remote',
        HOST: '0.0.0.0',
      })
    ).toThrow(/GPTROUTER_ALLOWED_HOSTS/);
  });

  it('requires a strong bootstrap bearer secret in remote mode', () => {
    expect(() =>
      loadHttpServerConfig({
        GPTROUTER_HTTP_MODE: 'remote',
        HOST: '0.0.0.0',
        GPTROUTER_ALLOWED_HOSTS: 'api.example.com',
        GPTROUTER_ALLOWED_ORIGINS: 'https://chatgpt.com',
        GPTROUTER_BEARER_TOKEN: 'too-short',
      })
    ).toThrow(/at least 32 characters/);
  });

  it('loads an explicit remote configuration', () => {
    const token = '0123456789abcdef0123456789abcdef';
    const config = loadHttpServerConfig({
      GPTROUTER_HTTP_MODE: 'remote',
      HOST: '0.0.0.0',
      PORT: '8443',
      GPTROUTER_ALLOWED_HOSTS: 'api.example.com,api2.example.com',
      GPTROUTER_ALLOWED_ORIGINS: 'https://chatgpt.com,https://example.com',
      GPTROUTER_BEARER_TOKEN: token,
    });

    expect(config).toMatchObject({
      mode: 'remote',
      host: '0.0.0.0',
      port: 8443,
      allowedHosts: ['api.example.com', 'api2.example.com'],
      allowedOrigins: ['https://chatgpt.com', 'https://example.com'],
      bearerToken: token,
    });
  });
});

describe('HTTP request boundary primitives', () => {
  it('parses hostnames with optional ports', () => {
    expect(parseHostHeader('api.example.com:443')).toBe('api.example.com');
    expect(parseHostHeader('[::1]:3000')).toBe('::1');
  });

  it('rejects malformed or userinfo-like Host headers', () => {
    expect(parseHostHeader('user@api.example.com')).toBeNull();
    expect(parseHostHeader('api.example.com/path')).toBeNull();
    expect(parseHostHeader('api.example.com:abc')).toBeNull();
  });

  it('allows only explicitly configured hosts', () => {
    expect(isAllowedHost('api.example.com:443', ['api.example.com'])).toBe(true);
    expect(isAllowedHost('evil.example.com', ['api.example.com'])).toBe(false);
    expect(isAllowedHost(undefined, ['api.example.com'])).toBe(false);
  });

  it('allows an absent Origin for non-browser MCP clients', () => {
    expect(isAllowedOrigin(undefined, ['https://chatgpt.com'])).toBe(true);
  });

  it('requires an exact HTTPS origin when Origin is present', () => {
    const allowed = ['https://chatgpt.com'];
    expect(isAllowedOrigin('https://chatgpt.com', allowed)).toBe(true);
    expect(isAllowedOrigin('https://evil.chatgpt.com', allowed)).toBe(false);
    expect(isAllowedOrigin('http://chatgpt.com', allowed)).toBe(false);
    expect(isAllowedOrigin('https://user@chatgpt.com', allowed)).toBe(false);
    expect(isAllowedOrigin('null', allowed)).toBe(false);
  });

  it('compares bearer secrets without accepting prefixes or length mismatches', () => {
    const token = '0123456789abcdef0123456789abcdef';
    expect(hasValidBearerToken(`Bearer ${token}`, token)).toBe(true);
    expect(hasValidBearerToken(`Bearer ${token}x`, token)).toBe(false);
    expect(hasValidBearerToken(`Basic ${token}`, token)).toBe(false);
    expect(hasValidBearerToken(undefined, token)).toBe(false);
  });
});
