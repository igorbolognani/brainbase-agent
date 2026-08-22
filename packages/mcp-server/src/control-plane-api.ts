/**
 * GPTRouter Control Plane REST API
 *
 * Phase 6: Provisioning and admin endpoints over plain Node HTTP.
 * Uses repository interfaces for data access; credentials are never exposed.
 */

import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import type {
  Account,
  AccountRepository,
  Connection,
  ConnectionRepository,
  HealthState,
  PolicyRepository,
  PrincipalRepository,
  RouteRepository,
  RoutingPolicy,
  ConnectionType,
} from '@gptrouter/contracts';
import type { GPTRouterApplication } from './application.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ControlPlaneApiOptions {
  accountRepository: AccountRepository;
  connectionRepository: ConnectionRepository;
  policyRepository: PolicyRepository;
  routeRepository: RouteRepository;
  principalRepository: PrincipalRepository;
  application: GPTRouterApplication;
  clock?: () => Date;
}

export interface ControlPlaneApi {
  server: Server;
  listen(port: number, host?: string): Promise<void>;
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function jsonResponse(res: ServerResponse, status: number, body: Record<string, unknown>): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Route matching
// ---------------------------------------------------------------------------

interface RouteMatch {
  params: Record<string, string>;
}

function matchRoute(pattern: string, pathname: string): RouteMatch | null {
  const patternParts = pattern.split('/');
  const pathParts = pathname.split('/');

  if (patternParts.length !== pathParts.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(':')) {
      params[patternParts[i].slice(1)] = decodeURIComponent(pathParts[i]);
    } else if (patternParts[i] !== pathParts[i]) {
      return null;
    }
  }
  return { params };
}

// ---------------------------------------------------------------------------
// Provisioning handlers
// ---------------------------------------------------------------------------

async function handleCreateAccount(
  req: IncomingMessage,
  res: ServerResponse,
  repos: ControlPlaneApiOptions
): Promise<void> {
  const raw = await readBody(req);
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      jsonResponse(res, 400, { error: 'validation_error', message: 'body must be an object' });
      return;
    }
    body = parsed as Record<string, unknown>;
  } catch {
    jsonResponse(res, 400, { error: 'invalid_json' });
    return;
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) {
    jsonResponse(res, 400, { error: 'validation_error', message: 'name is required' });
    return;
  }

  const now = repos.clock?.() ?? new Date();
  const account: Account = {
    account_id: `account_${randomUUID()}`,
    name,
    created_at: now,
    updated_at: now,
  };

  await repos.accountRepository.createAccount(account);
  jsonResponse(res, 201, { account_id: account.account_id, name: account.name });
}

async function handleCreateProviderConnection(
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
  repos: ControlPlaneApiOptions
): Promise<void> {
  const accountId = params.accountId;
  const account = await repos.accountRepository.getAccount(accountId);
  if (!account) {
    jsonResponse(res, 404, { error: 'account_not_found' });
    return;
  }

  const raw = await readBody(req);
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      jsonResponse(res, 400, { error: 'validation_error', message: 'body must be an object' });
      return;
    }
    body = parsed as Record<string, unknown>;
  } catch {
    jsonResponse(res, 400, { error: 'invalid_json' });
    return;
  }

  const provider = typeof body.provider === 'string' ? body.provider.trim() : '';
  if (!provider) {
    jsonResponse(res, 400, { error: 'validation_error', message: 'provider is required' });
    return;
  }

  const credentialReference =
    typeof body.credential_reference === 'string' ? body.credential_reference.trim() : '';
  if (!credentialReference) {
    jsonResponse(res, 400, {
      error: 'validation_error',
      message: 'credential_reference is required (opaque reference, never plain text)',
    });
    return;
  }

  const now = repos.clock?.() ?? new Date();
  const connection: Connection = {
    type: 'provider',
    connection_id: `conn_${randomUUID()}`,
    account_id: accountId,
    provider,
    status: 'active',
    credential_reference: credentialReference,
    created_at: now,
    updated_at: now,
  } as Connection;

  await repos.connectionRepository.createConnection(connection);
  jsonResponse(res, 201, {
    connection_id: connection.connection_id,
    type: connection.type,
    provider,
    status: connection.status,
  });
}

async function handleCreatePolicy(
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
  repos: ControlPlaneApiOptions
): Promise<void> {
  const accountId = params.accountId;
  const account = await repos.accountRepository.getAccount(accountId);
  if (!account) {
    jsonResponse(res, 404, { error: 'account_not_found' });
    return;
  }

  const raw = await readBody(req);
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      jsonResponse(res, 400, { error: 'validation_error', message: 'body must be an object' });
      return;
    }
    body = parsed as Record<string, unknown>;
  } catch {
    jsonResponse(res, 400, { error: 'invalid_json' });
    return;
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) {
    jsonResponse(res, 400, { error: 'validation_error', message: 'name is required' });
    return;
  }

  const orderingStrategy = body.ordering_strategy;
  if (
    orderingStrategy !== 'cost' &&
    orderingStrategy !== 'quality' &&
    orderingStrategy !== 'latency' &&
    orderingStrategy !== 'balanced' &&
    orderingStrategy !== 'custom'
  ) {
    jsonResponse(res, 400, {
      error: 'validation_error',
      message: 'ordering_strategy must be one of: cost, quality, latency, balanced, custom',
    });
    return;
  }

  const now = repos.clock?.() ?? new Date();
  const policy: RoutingPolicy = {
    policy_id: `policy_${randomUUID()}`,
    account_id: accountId,
    name,
    ordering_strategy: orderingStrategy,
    admissibility_rules: (body.admissibility_rules as RoutingPolicy['admissibility_rules']) ?? {},
    budget_constraints: (body.budget_constraints as RoutingPolicy['budget_constraints']) ?? {},
    retry_policy: body.retry_policy as RoutingPolicy['retry_policy'],
    manual_override_allowed: Boolean(body.manual_override_allowed),
    version: 1,
    created_at: now,
    updated_at: now,
  };

  await repos.policyRepository.createPolicy(policy);
  jsonResponse(res, 201, {
    policy_id: policy.policy_id,
    name: policy.name,
    ordering_strategy: policy.ordering_strategy,
    version: policy.version,
  });
}

async function handleCreateGatewayConnection(
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
  repos: ControlPlaneApiOptions
): Promise<void> {
  const accountId = params.accountId;
  const account = await repos.accountRepository.getAccount(accountId);
  if (!account) {
    jsonResponse(res, 404, { error: 'account_not_found' });
    return;
  }

  const raw = await readBody(req);
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      jsonResponse(res, 400, { error: 'validation_error', message: 'body must be an object' });
      return;
    }
    body = parsed as Record<string, unknown>;
  } catch {
    jsonResponse(res, 400, { error: 'invalid_json' });
    return;
  }

  const gatewayUrl = typeof body.gateway_url === 'string' ? body.gateway_url.trim() : '';
  if (!gatewayUrl) {
    jsonResponse(res, 400, { error: 'validation_error', message: 'gateway_url is required' });
    return;
  }

  let parsed: URL;
  try {
    parsed = new URL(gatewayUrl);
  } catch {
    jsonResponse(res, 400, {
      error: 'validation_error',
      message: 'gateway_url must be a valid URL',
    });
    return;
  }
  if (parsed.protocol !== 'https:') {
    jsonResponse(res, 400, {
      error: 'validation_error',
      message: 'gateway_url must use HTTPS',
    });
    return;
  }

  const gatewayType = typeof body.gateway_type === 'string' ? body.gateway_type.trim() : '';
  if (!gatewayType) {
    jsonResponse(res, 400, { error: 'validation_error', message: 'gateway_type is required' });
    return;
  }

  const credentialReference =
    typeof body.credential_reference === 'string' ? body.credential_reference.trim() : '';
  if (!credentialReference) {
    jsonResponse(res, 400, {
      error: 'validation_error',
      message: 'credential_reference is required (opaque reference, never plain text)',
    });
    return;
  }

  const now = repos.clock?.() ?? new Date();
  const connection: Connection = {
    type: 'gateway',
    connection_id: `conn_${randomUUID()}`,
    account_id: accountId,
    gateway_url: gatewayUrl,
    gateway_type: gatewayType,
    status: 'active',
    credential_reference: credentialReference,
    created_at: now,
    updated_at: now,
  } as Connection;

  await repos.connectionRepository.createConnection(connection);
  jsonResponse(res, 201, {
    connection_id: connection.connection_id,
    type: connection.type,
    gateway_url: gatewayUrl,
    gateway_type: gatewayType,
    status: connection.status,
  });
}

// ---------------------------------------------------------------------------
// Admin handlers
// ---------------------------------------------------------------------------

async function handleAdminStatus(
  _req: IncomingMessage,
  res: ServerResponse,
  startedAt: Date
): Promise<void> {
  const uptimeMs = Date.now() - startedAt.getTime();
  jsonResponse(res, 200, {
    version: '0.1.0',
    uptime_ms: uptimeMs,
    mode: 'control_plane',
  });
}

async function handleAdminListConnections(
  _req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
  repos: ControlPlaneApiOptions
): Promise<void> {
  const accountId = params.accountId;
  const account = await repos.accountRepository.getAccount(accountId);
  if (!account) {
    jsonResponse(res, 404, { error: 'account_not_found' });
    return;
  }

  const connections = await repos.connectionRepository.listConnections(accountId);
  jsonResponse(res, 200, {
    account_id: accountId,
    connections: connections.map((c) => ({
      connection_id: c.connection_id,
      type: c.type,
      status: c.status,
      created_at: c.created_at.toISOString(),
      updated_at: c.updated_at.toISOString(),
    })),
  });
}

async function handleAdminConnectionHealth(
  _req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
  repos: ControlPlaneApiOptions
): Promise<void> {
  const accountId = params.accountId;
  const account = await repos.accountRepository.getAccount(accountId);
  if (!account) {
    jsonResponse(res, 404, { error: 'account_not_found' });
    return;
  }

  const connections = await repos.connectionRepository.listConnections(accountId);
  const healthStates: Array<{
    connection_id: string;
    type: ConnectionType;
    status: string;
    health: HealthState;
  }> = connections.map((c) => {
    let health: HealthState;
    switch (c.status) {
      case 'active':
        health = 'healthy';
        break;
      case 'error':
        health = 'unavailable';
        break;
      case 'expired':
        health = 'degraded';
        break;
      case 'revoked':
        health = 'disabled';
        break;
      default:
        health = 'unavailable';
    }
    return {
      connection_id: c.connection_id,
      type: c.type,
      status: c.status,
      health,
    };
  });

  jsonResponse(res, 200, {
    account_id: accountId,
    health: healthStates,
  });
}

// ---------------------------------------------------------------------------
// Routing handler (delegates to application)
// ---------------------------------------------------------------------------

async function handleRouteTask(
  req: IncomingMessage,
  res: ServerResponse,
  repos: ControlPlaneApiOptions
): Promise<void> {
  const raw = await readBody(req);
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      jsonResponse(res, 400, { error: 'validation_error', message: 'body must be an object' });
      return;
    }
    body = parsed as Record<string, unknown>;
  } catch {
    jsonResponse(res, 400, { error: 'invalid_json' });
    return;
  }

  const description = typeof body.description === 'string' ? body.description.trim() : '';
  if (!description) {
    jsonResponse(res, 400, { error: 'validation_error', message: 'description is required' });
    return;
  }

  const requiredCapabilities = Array.isArray(body.required_capabilities)
    ? body.required_capabilities.filter((c): c is string => typeof c === 'string')
    : [];
  if (requiredCapabilities.length === 0) {
    jsonResponse(res, 400, {
      error: 'validation_error',
      message: 'required_capabilities must be a non-empty array of strings',
    });
    return;
  }

  const orderingStrategy = body.ordering_strategy;
  if (orderingStrategy !== 'cost') {
    jsonResponse(res, 400, {
      error: 'validation_error',
      message: 'ordering_strategy must be "cost" (V0.1)',
    });
    return;
  }

  try {
    const context = repos.application.getSyntheticAuthorizedContext();
    const result = await repos.application.planTask(
      {
        description,
        required_capabilities: requiredCapabilities,
        ordering_strategy: orderingStrategy,
      },
      context
    );
    jsonResponse(res, 200, result as unknown as Record<string, unknown>);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'routing_error';
    jsonResponse(res, 500, { error: 'routing_error', message });
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createControlPlaneApi(options: ControlPlaneApiOptions): ControlPlaneApi {
  const startedAt = options.clock?.() ?? new Date();

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const pathname = url.pathname;
    const method = req.method ?? 'GET';

    try {
      // POST /v1/accounts
      if (method === 'POST' && pathname === '/v1/accounts') {
        await handleCreateAccount(req, res, options);
        return;
      }

      // POST /v1/accounts/:accountId/connections
      let match: RouteMatch | null;
      if (
        method === 'POST' &&
        (match = matchRoute('/v1/accounts/:accountId/connections', pathname))
      ) {
        await handleCreateProviderConnection(req, res, match.params, options);
        return;
      }

      // POST /v1/accounts/:accountId/policies
      if (method === 'POST' && (match = matchRoute('/v1/accounts/:accountId/policies', pathname))) {
        await handleCreatePolicy(req, res, match.params, options);
        return;
      }

      // POST /v1/accounts/:accountId/gateways
      if (method === 'POST' && (match = matchRoute('/v1/accounts/:accountId/gateways', pathname))) {
        await handleCreateGatewayConnection(req, res, match.params, options);
        return;
      }

      // GET /v1/admin/status
      if (method === 'GET' && pathname === '/v1/admin/status') {
        await handleAdminStatus(req, res, startedAt);
        return;
      }

      // GET /v1/admin/accounts/:accountId/connections
      if (
        method === 'GET' &&
        (match = matchRoute('/v1/admin/accounts/:accountId/connections', pathname))
      ) {
        await handleAdminListConnections(req, res, match.params, options);
        return;
      }

      // GET /v1/admin/accounts/:accountId/health
      if (
        method === 'GET' &&
        (match = matchRoute('/v1/admin/accounts/:accountId/health', pathname))
      ) {
        await handleAdminConnectionHealth(req, res, match.params, options);
        return;
      }

      // POST /v1/route
      if (method === 'POST' && pathname === '/v1/route') {
        await handleRouteTask(req, res, options);
        return;
      }

      jsonResponse(res, 404, { error: 'not_found' });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'internal_error';
      jsonResponse(res, 500, { error: 'internal_error', message });
    }
  }

  const server = createServer((req, res) => {
    void handleRequest(req, res);
  });

  return {
    server,
    listen(port: number, host = '127.0.0.1'): Promise<void> {
      return new Promise((resolve, reject) => {
        server.listen(port, host, () => resolve());
        server.on('error', reject);
      });
    },
    close(): Promise<void> {
      return new Promise((resolve, reject) => {
        if (!server.listening) {
          resolve();
          return;
        }
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}
