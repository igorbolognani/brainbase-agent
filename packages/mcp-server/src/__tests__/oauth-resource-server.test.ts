import { describe, expect, it, vi } from 'vitest';
import type {
  AuthInfo,
  McpHttpHandler,
  OAuthMetadata,
  OAuthTokenVerifier,
} from '@modelcontextprotocol/server';
import { createOAuthProtectedMcpHandler } from '../oauth-resource-server.js';

const RESOURCE = new URL('https://api.example.com/mcp');
const OAUTH_METADATA: OAuthMetadata = {
  issuer: 'https://auth.example.com',
  authorization_endpoint: 'https://auth.example.com/authorize',
  token_endpoint: 'https://auth.example.com/token',
  response_types_supported: ['code'],
  scopes_supported: ['mcp', 'gptrouter:read'],
};

function authInfo(token: string, scopes: string[]): AuthInfo {
  return {
    token,
    clientId: 'principal-1',
    scopes,
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
  };
}

function verifier(): OAuthTokenVerifier {
  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      if (token === 'valid-token') return authInfo(token, ['mcp', 'gptrouter:read']);
      if (token === 'low-scope-token') return authInfo(token, ['gptrouter:read']);
      return authInfo(token, ['mcp']);
    },
  };
}

function fakeHandler(observed: { auth?: AuthInfo }): McpHttpHandler {
  return {
    fetch: vi.fn(
      async (_request: Request, options?: Parameters<McpHttpHandler['fetch']>[1]) => {
        observed.auth = options?.authInfo;
        return Response.json({ ok: true });
      }
    ),
    close: vi.fn(async () => undefined),
    notify: {} as McpHttpHandler['notify'],
    bus: {} as McpHttpHandler['bus'],
  };
}

describe('OAuth resource-server MCP wrapper', () => {
  it('publishes path-aware protected resource metadata without a bearer token', async () => {
    const wrapped = createOAuthProtectedMcpHandler(fakeHandler({}), {
      verifier: verifier(),
      oauthMetadata: OAUTH_METADATA,
      resourceServerUrl: RESOURCE,
    });

    const response = await wrapped.fetch(
      new Request('https://api.example.com/.well-known/oauth-protected-resource/mcp')
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      resource: 'https://api.example.com/mcp',
      authorization_servers: ['https://auth.example.com'],
    });
  });

  it('returns an OAuth bearer challenge when the access token is missing', async () => {
    const wrapped = createOAuthProtectedMcpHandler(fakeHandler({}), {
      verifier: verifier(),
      oauthMetadata: OAUTH_METADATA,
      resourceServerUrl: RESOURCE,
    });

    const response = await wrapped.fetch(new Request(RESOURCE));

    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain('Bearer');
    expect(response.headers.get('www-authenticate')).toContain('resource_metadata');
  });

  it('returns insufficient_scope before MCP dispatch', async () => {
    const downstream = fakeHandler({});
    const wrapped = createOAuthProtectedMcpHandler(downstream, {
      verifier: verifier(),
      oauthMetadata: OAUTH_METADATA,
      resourceServerUrl: RESOURCE,
      requiredScopes: ['mcp'],
    });

    const response = await wrapped.fetch(
      new Request(RESOURCE, {
        headers: { authorization: 'Bearer low-scope-token' },
      })
    );

    expect(response.status).toBe(403);
    expect(downstream.fetch).not.toHaveBeenCalled();
  });

  it('forwards only verified AuthInfo into the canonical MCP handler', async () => {
    const observed: { auth?: AuthInfo } = {};
    const wrapped = createOAuthProtectedMcpHandler(fakeHandler(observed), {
      verifier: verifier(),
      oauthMetadata: OAUTH_METADATA,
      resourceServerUrl: RESOURCE,
    });

    const response = await wrapped.fetch(
      new Request(RESOURCE, {
        headers: { authorization: 'Bearer valid-token' },
      })
    );

    expect(response.status).toBe(200);
    expect(observed.auth).toMatchObject({
      clientId: 'principal-1',
      scopes: ['mcp', 'gptrouter:read'],
    });
  });

  it('does not expose arbitrary paths through the OAuth wrapper', async () => {
    const wrapped = createOAuthProtectedMcpHandler(fakeHandler({}), {
      verifier: verifier(),
      oauthMetadata: OAUTH_METADATA,
      resourceServerUrl: RESOURCE,
    });

    const response = await wrapped.fetch(new Request('https://api.example.com/private'));
    expect(response.status).toBe(404);
  });
});
