import { once } from 'node:events';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  Account,
  Connection,
  GatewayConnection,
  ProviderConnection,
  RoutingPolicy,
} from '@gptrouter/contracts';
import { createSyntheticGPTRouterApplication } from '../application.js';
import {
  createControlPlaneApi,
  type ControlPlaneApi,
  type ControlPlaneApiOptions,
} from '../control-plane-api.js';

interface HttpResult {
  status: number;
  body: string;
  headers: Record<string, string | string[] | undefined>;
}

function post(
  port: number,
  path: string,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<HttpResult> {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(payload)),
          ...headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
            headers: res.headers,
          })
        );
      }
    );
    req.on('error', reject);
    req.end(payload);
  });
}

function get(
  port: number,
  path: string,
  headers: Record<string, string> = {}
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'GET',
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
            headers: res.headers,
          })
        );
      }
    );
    req.on('error', reject);
    req.end();
  });
}

function parseJson(body: string): Record<string, unknown> {
  return JSON.parse(body) as Record<string, unknown>;
}

async function listen(api: ControlPlaneApi): Promise<number> {
  api.server.listen(0, '127.0.0.1');
  await once(api.server, 'listening');
  return (api.server.address() as AddressInfo).port;
}

function createTestOptions(): ControlPlaneApiOptions & {
  _accounts: Map<string, Account>;
  _connections: Map<string, Connection>;
  _policies: Map<string, RoutingPolicy>;
} {
  const accounts = new Map<string, Account>();
  const connections = new Map<string, Connection>();
  const policies = new Map<string, RoutingPolicy>();
  const application = createSyntheticGPTRouterApplication();

  return {
    _accounts: accounts,
    _connections: connections,
    _policies: policies,
    accountRepository: {
      getAccount: async (account_id) => accounts.get(account_id) ?? null,
      createAccount: async (account) => {
        const created: Account = {
          ...account,
          created_at: new Date(),
          updated_at: new Date(),
        };
        accounts.set(created.account_id, created);
        return created;
      },
    },
    connectionRepository: {
      listConnections: async (account_id) =>
        [...connections.values()].filter((c) => c.account_id === account_id),
      getConnection: async (connection_id) => connections.get(connection_id) ?? null,
      createConnection: async (connection) => {
        if (connection.type === 'provider') {
          const created: ProviderConnection = {
            type: 'provider',
            connection_id: connection.connection_id,
            account_id: connection.account_id,
            provider: (connection as ProviderConnection).provider,
            status: connection.status,
            credential_reference: connection.credential_reference,
            created_at: new Date(),
            updated_at: new Date(),
          };
          connections.set(created.connection_id, created);
          return created;
        }
        const gw = connection as GatewayConnection;
        const created: GatewayConnection = {
          type: 'gateway',
          connection_id: gw.connection_id,
          account_id: gw.account_id,
          gateway_url: gw.gateway_url,
          gateway_type: gw.gateway_type,
          status: gw.status,
          credential_reference: gw.credential_reference,
          created_at: new Date(),
          updated_at: new Date(),
        };
        connections.set(created.connection_id, created);
        return created;
      },
      updateConnectionStatus: async () => {},
      deleteConnection: async () => {},
    },
    policyRepository: {
      getPolicy: async (policy_id) => policies.get(policy_id) ?? null,
      getDefaultPolicy: async (account_id) =>
        [...policies.values()].find((p) => p.account_id === account_id) ?? null,
      listPolicies: async (account_id) =>
        [...policies.values()].filter((p) => p.account_id === account_id),
      createPolicy: async (policy) => {
        const created: RoutingPolicy = {
          ...policy,
          created_at: new Date(),
          updated_at: new Date(),
        };
        policies.set(created.policy_id, created);
        return created;
      },
      updatePolicy: async (policy) => {
        const updated = { ...policy, updated_at: new Date() };
        policies.set(updated.policy_id, updated);
        return updated;
      },
    },
    routeRepository: {
      listRoutes: async () => [],
      getRoute: async () => null,
      getRoutesForConnection: async () => [],
      updateRouteAvailability: async () => {},
    },
    principalRepository: {
      getPrincipal: async () => null,
      getPrincipalBySubject: async () => null,
    },
    application,
  };
}

describe('Control Plane API', () => {
  let api: ControlPlaneApi;
  let port: number;

  beforeEach(async () => {
    api = createControlPlaneApi(createTestOptions());
    port = await listen(api);
  });

  afterEach(async () => {
    await api.close();
  });

  describe('POST /v1/accounts', () => {
    it('creates an account and returns opaque ID', async () => {
      const result = await post(port, '/v1/accounts', { name: 'Test Account' });
      expect(result.status).toBe(201);
      const body = parseJson(result.body);
      expect(body.account_id).toMatch(/^account_/);
      expect(body.name).toBe('Test Account');
    });

    it('rejects missing name', async () => {
      const result = await post(port, '/v1/accounts', {});
      expect(result.status).toBe(400);
      const body = parseJson(result.body);
      expect(body.error).toBe('validation_error');
      expect(body.message).toContain('name');
    });

    it('rejects empty name', async () => {
      const result = await post(port, '/v1/accounts', { name: '  ' });
      expect(result.status).toBe(400);
      const body = parseJson(result.body);
      expect(body.error).toBe('validation_error');
    });

    it('rejects invalid JSON', async () => {
      const result = await post(port, '/v1/accounts', '{broken');
      expect(result.status).toBe(400);
      const body = parseJson(result.body);
      expect(body.error).toBe('invalid_json');
    });
  });

  describe('POST /v1/accounts/:accountId/connections', () => {
    it('creates a provider connection and returns opaque ID', async () => {
      const acct = await post(port, '/v1/accounts', { name: 'Conn Test' });
      const accountId = parseJson(acct.body).account_id as string;

      const result = await post(port, `/v1/accounts/${accountId}/connections`, {
        provider: 'openai',
        credential_reference: 'opaque-ref-123',
      });
      expect(result.status).toBe(201);
      const body = parseJson(result.body);
      expect(body.connection_id).toMatch(/^conn_/);
      expect(body.type).toBe('provider');
      expect(body.provider).toBe('openai');
      expect(body.status).toBe('active');
    });

    it('rejects missing provider', async () => {
      const acct = await post(port, '/v1/accounts', { name: 'Conn Test' });
      const accountId = parseJson(acct.body).account_id as string;

      const result = await post(port, `/v1/accounts/${accountId}/connections`, {
        credential_reference: 'opaque-ref-123',
      });
      expect(result.status).toBe(400);
      const body = parseJson(result.body);
      expect(body.error).toBe('validation_error');
      expect(body.message).toContain('provider');
    });

    it('rejects missing credential_reference', async () => {
      const acct = await post(port, '/v1/accounts', { name: 'Conn Test' });
      const accountId = parseJson(acct.body).account_id as string;

      const result = await post(port, `/v1/accounts/${accountId}/connections`, {
        provider: 'openai',
      });
      expect(result.status).toBe(400);
      const body = parseJson(result.body);
      expect(body.error).toBe('validation_error');
      expect(body.message).toContain('credential_reference');
    });

    it('returns 404 for nonexistent account', async () => {
      const result = await post(port, '/v1/accounts/account_nonexistent/connections', {
        provider: 'openai',
        credential_reference: 'ref',
      });
      expect(result.status).toBe(404);
      const body = parseJson(result.body);
      expect(body.error).toBe('account_not_found');
    });
  });

  describe('POST /v1/accounts/:accountId/policies', () => {
    it('creates a routing policy', async () => {
      const acct = await post(port, '/v1/accounts', { name: 'Policy Test' });
      const accountId = parseJson(acct.body).account_id as string;

      const result = await post(port, `/v1/accounts/${accountId}/policies`, {
        name: 'Cost First',
        ordering_strategy: 'cost',
      });
      expect(result.status).toBe(201);
      const body = parseJson(result.body);
      expect(body.policy_id).toMatch(/^policy_/);
      expect(body.name).toBe('Cost First');
      expect(body.ordering_strategy).toBe('cost');
      expect(body.version).toBe(1);
    });

    it('rejects missing name', async () => {
      const acct = await post(port, '/v1/accounts', { name: 'Policy Test' });
      const accountId = parseJson(acct.body).account_id as string;

      const result = await post(port, `/v1/accounts/${accountId}/policies`, {
        ordering_strategy: 'cost',
      });
      expect(result.status).toBe(400);
      const body = parseJson(result.body);
      expect(body.error).toBe('validation_error');
      expect(body.message).toContain('name');
    });

    it('rejects invalid ordering_strategy', async () => {
      const acct = await post(port, '/v1/accounts', { name: 'Policy Test' });
      const accountId = parseJson(acct.body).account_id as string;

      const result = await post(port, `/v1/accounts/${accountId}/policies`, {
        name: 'Bad',
        ordering_strategy: 'invalid',
      });
      expect(result.status).toBe(400);
      const body = parseJson(result.body);
      expect(body.error).toBe('validation_error');
      expect(body.message).toContain('ordering_strategy');
    });

    it('returns 404 for nonexistent account', async () => {
      const result = await post(port, '/v1/accounts/account_nonexistent/policies', {
        name: 'Test',
        ordering_strategy: 'cost',
      });
      expect(result.status).toBe(404);
    });
  });

  describe('POST /v1/accounts/:accountId/gateways', () => {
    it('creates a gateway connection', async () => {
      const acct = await post(port, '/v1/accounts', { name: 'GW Test' });
      const accountId = parseJson(acct.body).account_id as string;

      const result = await post(port, `/v1/accounts/${accountId}/gateways`, {
        gateway_url: 'https://openrouter.example.com',
        gateway_type: 'openrouter',
        credential_reference: 'opaque-gw-ref',
      });
      expect(result.status).toBe(201);
      const body = parseJson(result.body);
      expect(body.connection_id).toMatch(/^conn_/);
      expect(body.type).toBe('gateway');
      expect(body.gateway_url).toBe('https://openrouter.example.com');
      expect(body.gateway_type).toBe('openrouter');
      expect(body.status).toBe('active');
    });

    it('rejects non-HTTPS gateway_url', async () => {
      const acct = await post(port, '/v1/accounts', { name: 'GW Test' });
      const accountId = parseJson(acct.body).account_id as string;

      const result = await post(port, `/v1/accounts/${accountId}/gateways`, {
        gateway_url: 'http://openrouter.example.com',
        gateway_type: 'openrouter',
        credential_reference: 'opaque-gw-ref',
      });
      expect(result.status).toBe(400);
      const body = parseJson(result.body);
      expect(body.error).toBe('validation_error');
      expect(body.message).toContain('HTTPS');
    });

    it('rejects missing gateway_url', async () => {
      const acct = await post(port, '/v1/accounts', { name: 'GW Test' });
      const accountId = parseJson(acct.body).account_id as string;

      const result = await post(port, `/v1/accounts/${accountId}/gateways`, {
        gateway_type: 'openrouter',
        credential_reference: 'opaque-gw-ref',
      });
      expect(result.status).toBe(400);
    });

    it('rejects missing gateway_type', async () => {
      const acct = await post(port, '/v1/accounts', { name: 'GW Test' });
      const accountId = parseJson(acct.body).account_id as string;

      const result = await post(port, `/v1/accounts/${accountId}/gateways`, {
        gateway_url: 'https://openrouter.example.com',
        credential_reference: 'opaque-gw-ref',
      });
      expect(result.status).toBe(400);
      const body = parseJson(result.body);
      expect(body.error).toBe('validation_error');
      expect(body.message).toContain('gateway_type');
    });
  });

  describe('GET /v1/admin/status', () => {
    it('returns system status with version, uptime, mode', async () => {
      const result = await get(port, '/v1/admin/status');
      expect(result.status).toBe(200);
      const body = parseJson(result.body);
      expect(body.version).toBe('0.1.0');
      expect(typeof body.uptime_ms).toBe('number');
      expect((body.uptime_ms as number) >= 0).toBe(true);
      expect(body.mode).toBe('control_plane');
    });
  });

  describe('GET /v1/admin/accounts/:accountId/connections', () => {
    it('returns connections for an existing account', async () => {
      const acct = await post(port, '/v1/accounts', { name: 'Admin Test' });
      const accountId = parseJson(acct.body).account_id as string;

      const result = await get(port, `/v1/admin/accounts/${accountId}/connections`);
      expect(result.status).toBe(200);
      const body = parseJson(result.body);
      expect(body.account_id).toBe(accountId);
      expect(Array.isArray(body.connections)).toBe(true);
    });

    it('returns 404 for nonexistent account', async () => {
      const result = await get(port, '/v1/admin/accounts/account_nonexistent/connections');
      expect(result.status).toBe(404);
      const body = parseJson(result.body);
      expect(body.error).toBe('account_not_found');
    });
  });

  describe('GET /v1/admin/accounts/:accountId/health', () => {
    it('returns health states for an existing account', async () => {
      const acct = await post(port, '/v1/accounts', { name: 'Health Test' });
      const accountId = parseJson(acct.body).account_id as string;

      const result = await get(port, `/v1/admin/accounts/${accountId}/health`);
      expect(result.status).toBe(200);
      const body = parseJson(result.body);
      expect(body.account_id).toBe(accountId);
      expect(Array.isArray(body.health)).toBe(true);
    });

    it('returns 404 for nonexistent account', async () => {
      const result = await get(port, '/v1/admin/accounts/account_nonexistent/health');
      expect(result.status).toBe(404);
    });
  });

  describe('POST /v1/route', () => {
    it('routes a task through the application', async () => {
      const result = await post(port, '/v1/route', {
        description: 'Test routing',
        required_capabilities: ['text'],
        ordering_strategy: 'cost',
      });
      expect(result.status).toBe(200);
      const body = parseJson(result.body);
      expect(body.task_id).toMatch(/^task_/);
      expect(body.decision_id).toBeDefined();
      expect(body.status).toBe('planning');
    });

    it('rejects missing description', async () => {
      const result = await post(port, '/v1/route', {
        required_capabilities: ['text'],
        ordering_strategy: 'cost',
      });
      expect(result.status).toBe(400);
      const body = parseJson(result.body);
      expect(body.error).toBe('validation_error');
      expect(body.message).toContain('description');
    });

    it('rejects empty required_capabilities', async () => {
      const result = await post(port, '/v1/route', {
        description: 'Test',
        required_capabilities: [],
        ordering_strategy: 'cost',
      });
      expect(result.status).toBe(400);
      const body = parseJson(result.body);
      expect(body.error).toBe('validation_error');
      expect(body.message).toContain('required_capabilities');
    });

    it('rejects non-cost ordering_strategy', async () => {
      const result = await post(port, '/v1/route', {
        description: 'Test',
        required_capabilities: ['text'],
        ordering_strategy: 'quality',
      });
      expect(result.status).toBe(400);
      const body = parseJson(result.body);
      expect(body.error).toBe('validation_error');
    });
  });

  describe('404 handling', () => {
    it('returns 404 for unknown routes', async () => {
      const result = await get(port, '/v1/unknown');
      expect(result.status).toBe(404);
      const body = parseJson(result.body);
      expect(body.error).toBe('not_found');
    });

    it('returns 404 for unknown POST routes', async () => {
      const result = await post(port, '/v1/unknown', {});
      expect(result.status).toBe(404);
    });
  });
});

describe('Control Plane API - credential safety', () => {
  let api: ControlPlaneApi;
  let port: number;

  beforeEach(async () => {
    api = createControlPlaneApi(createTestOptions());
    port = await listen(api);
  });

  afterEach(async () => {
    await api.close();
  });

  it('never exposes credential_reference in connection responses', async () => {
    const acct = await post(port, '/v1/accounts', { name: 'Safety Test' });
    const accountId = parseJson(acct.body).account_id as string;

    await post(port, `/v1/accounts/${accountId}/connections`, {
      provider: 'openai',
      credential_reference: 'super-secret-api-key-12345',
    });

    const connectionsResult = await get(port, `/v1/admin/accounts/${accountId}/connections`);
    expect(connectionsResult.status).toBe(200);
    expect(connectionsResult.body).not.toContain('super-secret-api-key');
    expect(connectionsResult.body).not.toContain('credential_reference');
  });

  it('never exposes credential_reference in gateway responses', async () => {
    const acct = await post(port, '/v1/accounts', { name: 'Safety GW Test' });
    const accountId = parseJson(acct.body).account_id as string;

    await post(port, `/v1/accounts/${accountId}/gateways`, {
      gateway_url: 'https://openrouter.example.com',
      gateway_type: 'openrouter',
      credential_reference: 'secret-gateway-token',
    });

    const healthResult = await get(port, `/v1/admin/accounts/${accountId}/health`);
    expect(healthResult.status).toBe(200);
    expect(healthResult.body).not.toContain('secret-gateway-token');
    expect(healthResult.body).not.toContain('credential_reference');
  });
});
