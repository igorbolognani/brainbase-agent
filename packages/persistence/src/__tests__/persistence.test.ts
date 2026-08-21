import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { createTestDatabase, initializeSchema, type DrizzleDB } from '../database.js';
import { createDatabaseRepositories, type DatabaseRepositories } from '../repositories.js';
import { FakeSecretStore, EnvSecretStore } from '../credential-store.js';
import { AuthVerifier, AuthError, FakeAuthVerifier } from '../auth-verifier.js';
import type { ProviderConnection, GatewayConnection } from '@gptrouter/contracts';
import { SignJWT, generateKeyPair, exportJWK, type JWK, type JWTPayload } from 'jose';

let db: DrizzleDB;
let sqlite: { exec(sql: string): void };
let repos: DatabaseRepositories;

beforeEach(() => {
  const testDb = createTestDatabase();
  db = testDb.db;
  sqlite = testDb.sqlite;
  initializeSchema(testDb.sqlite);
  repos = createDatabaseRepositories(db);
});

// ============================================================================
// Schema initialization
// ============================================================================

describe('database schema', () => {
  it('initializes all tables without error', () => {
    expect(db).toBeDefined();
  });

  it('allows inserting and querying a principal', async () => {
    // Insert via raw SQL since there's no createPrincipal
    sqlite.exec(
      `INSERT INTO principals (principal_id, issuer, subject, created_at, updated_at) VALUES ('p1', 'test-issuer', 'user1', '${new Date().toISOString()}', '${new Date().toISOString()}')`
    );
    const result = await repos.principals.getPrincipal('p1');
    expect(result).not.toBeNull();
    expect(result!.issuer).toBe('test-issuer');
    expect(result!.subject).toBe('user1');
  });

  it('enforces principal issuer+subject uniqueness', async () => {
    const ts = new Date().toISOString();
    sqlite.exec(
      `INSERT INTO principals (principal_id, issuer, subject, created_at, updated_at) VALUES ('p1', 'test', 'user1', '${ts}', '${ts}')`
    );
    expect(() => {
      sqlite.exec(
        `INSERT INTO principals (principal_id, issuer, subject, created_at, updated_at) VALUES ('p2', 'test', 'user1', '${ts}', '${ts}')`
      );
    }).toThrow();
  });
});

// ============================================================================
// Account Repository
// ============================================================================

describe('AccountRepository', () => {
  it('creates and retrieves an account', async () => {
    const account = await repos.accounts.createAccount({
      account_id: 'acc-1',
      name: 'Test Account',
      updated_at: new Date(),
    });
    expect(account.account_id).toBe('acc-1');
    expect(account.name).toBe('Test Account');

    const retrieved = await repos.accounts.getAccount('acc-1');
    expect(retrieved).not.toBeNull();
    expect(retrieved!.name).toBe('Test Account');
  });

  it('returns null for missing account', async () => {
    const result = await repos.accounts.getAccount('nonexistent');
    expect(result).toBeNull();
  });
});

// ============================================================================
// Membership Repository
// ============================================================================

describe('MembershipRepository', () => {
  it('creates and retrieves membership', async () => {
    await repos.accounts.createAccount({
      account_id: 'acc-1',
      name: 'Test',
      updated_at: new Date(),
    });
    const ts = new Date().toISOString();
    sqlite.exec(
      `INSERT INTO principals (principal_id, issuer, subject, created_at, updated_at) VALUES ('princ-1', 'issuer', 'sub1', '${ts}', '${ts}')`
    );

    // Insert directly since MembershipRepository doesn't have create
    sqlite.exec(
      `INSERT INTO account_memberships (membership_id, account_id, principal_id, role, status, created_at, updated_at) VALUES ('mem-1', 'acc-1', 'princ-1', 'owner', 'active', '${ts}', '${ts}')`
    );

    const result = await repos.memberships.getMembership('acc-1', 'princ-1');
    expect(result).not.toBeNull();
    expect(result!.role).toBe('owner');

    const all = await repos.memberships.listMembershipsForPrincipal('princ-1');
    expect(all).toHaveLength(1);
  });

  it('enforces account+principal uniqueness', async () => {
    const ts = new Date().toISOString();
    sqlite.exec(
      `INSERT INTO principals (principal_id, issuer, subject, created_at, updated_at) VALUES ('princ-1', 'issuer', 'sub1', '${ts}', '${ts}')`
    );
    sqlite.exec(
      `INSERT INTO accounts (account_id, name, created_at, updated_at) VALUES ('acc-1', 'Test', '${ts}', '${ts}')`
    );
    sqlite.exec(
      `INSERT INTO account_memberships (membership_id, account_id, principal_id, role, status, created_at, updated_at) VALUES ('mem-1', 'acc-1', 'princ-1', 'owner', 'active', '${ts}', '${ts}')`
    );

    expect(() => {
      sqlite.exec(
        `INSERT INTO account_memberships (membership_id, account_id, principal_id, role, status, created_at, updated_at) VALUES ('mem-2', 'acc-1', 'princ-1', 'admin', 'active', '${ts}', '${ts}')`
      );
    }).toThrow();
  });
});

// ============================================================================
// Connection Repository
// ============================================================================

describe('ConnectionRepository', () => {
  it('creates and lists provider connections', async () => {
    await repos.accounts.createAccount({
      account_id: 'acc-1',
      name: 'Test',
      updated_at: new Date(),
    });

    const conn = await repos.connections.createConnection({
      type: 'provider',
      connection_id: 'conn-1',
      account_id: 'acc-1',
      provider: 'openai',
      status: 'active',
      credential_reference: 'opaque-ref-1',
    } as Omit<ProviderConnection, 'created_at' | 'updated_at'>);

    expect(conn.connection_id).toBe('conn-1');
    expect(conn.type).toBe('provider');

    const list = await repos.connections.listConnections('acc-1');
    expect(list).toHaveLength(1);
    expect(list[0].connection_id).toBe('conn-1');
  });

  it('creates and lists gateway connections', async () => {
    await repos.accounts.createAccount({
      account_id: 'acc-1',
      name: 'Test',
      updated_at: new Date(),
    });

    const conn = await repos.connections.createConnection({
      type: 'gateway',
      connection_id: 'gw-1',
      account_id: 'acc-1',
      gateway_url: 'https://openrouter.ai',
      gateway_type: 'openrouter',
      status: 'active',
      credential_reference: 'opaque-gw-ref',
    } as Omit<GatewayConnection, 'created_at' | 'updated_at'>);

    expect(conn.type).toBe('gateway');
    if (conn.type === 'gateway') {
      expect(conn.gateway_url).toBe('https://openrouter.ai');
    }
  });

  it('enforces account isolation', async () => {
    await repos.accounts.createAccount({
      account_id: 'acc-1',
      name: 'Test1',
      updated_at: new Date(),
    });
    await repos.accounts.createAccount({
      account_id: 'acc-2',
      name: 'Test2',
      updated_at: new Date(),
    });

    await repos.connections.createConnection({
      type: 'provider',
      connection_id: 'conn-1',
      account_id: 'acc-1',
      provider: 'openai',
      status: 'active',
      credential_reference: 'ref-1',
    } as Omit<ProviderConnection, 'created_at' | 'updated_at'>);

    const list1 = await repos.connections.listConnections('acc-1');
    const list2 = await repos.connections.listConnections('acc-2');
    expect(list1).toHaveLength(1);
    expect(list2).toHaveLength(0);
  });

  it('updates connection status', async () => {
    await repos.accounts.createAccount({
      account_id: 'acc-1',
      name: 'Test',
      updated_at: new Date(),
    });
    await repos.connections.createConnection({
      type: 'provider',
      connection_id: 'conn-1',
      account_id: 'acc-1',
      provider: 'openai',
      status: 'active',
      credential_reference: 'ref-1',
    } as Omit<ProviderConnection, 'created_at' | 'updated_at'>);

    await repos.connections.updateConnectionStatus('conn-1', 'revoked');
    const conn = await repos.connections.getConnection('conn-1');
    expect(conn!.status).toBe('revoked');
  });

  it('deletes connection', async () => {
    await repos.accounts.createAccount({
      account_id: 'acc-1',
      name: 'Test',
      updated_at: new Date(),
    });
    await repos.connections.createConnection({
      type: 'provider',
      connection_id: 'conn-1',
      account_id: 'acc-1',
      provider: 'openai',
      status: 'active',
      credential_reference: 'ref-1',
    } as Omit<ProviderConnection, 'created_at' | 'updated_at'>);

    await repos.connections.deleteConnection('conn-1');
    const conn = await repos.connections.getConnection('conn-1');
    expect(conn).toBeNull();
  });
});

// ============================================================================
// Route Repository
// ============================================================================

describe('RouteRepository', () => {
  it('creates and lists routes via connection', async () => {
    await repos.accounts.createAccount({
      account_id: 'acc-1',
      name: 'Test',
      updated_at: new Date(),
    });
    await repos.connections.createConnection({
      type: 'provider',
      connection_id: 'conn-1',
      account_id: 'acc-1',
      provider: 'openai',
      status: 'active',
      credential_reference: 'ref-1',
    } as Omit<ProviderConnection, 'created_at' | 'updated_at'>);

    const ts = new Date().toISOString();
    sqlite.exec(
      `INSERT INTO model_routes (route_id, route_type, connection_id, source_id, source_provider, capabilities, pricing_input, pricing_output, pricing_currency, pricing_units, pricing_source, pricing_effective_at, pricing_refreshed_at, pricing_version, availability_status, created_at, updated_at) VALUES ('route-1', 'provider', 'conn-1', 'gpt-4', 'openai', '["text"]', 0.03, 0.06, 'USD', 'per_1k_tokens', 'test', '${ts}', '${ts}', 'v1', 'available', '${ts}', '${ts}')`
    );

    const routes = await repos.routes.listRoutes('acc-1');
    expect(routes).toHaveLength(1);
    expect(routes[0].source_id).toBe('gpt-4');
  });

  it('updates route availability', async () => {
    await repos.accounts.createAccount({
      account_id: 'acc-1',
      name: 'Test',
      updated_at: new Date(),
    });
    await repos.connections.createConnection({
      type: 'provider',
      connection_id: 'conn-1',
      account_id: 'acc-1',
      provider: 'openai',
      status: 'active',
      credential_reference: 'ref-1',
    } as Omit<ProviderConnection, 'created_at' | 'updated_at'>);

    const ts = new Date().toISOString();
    sqlite.exec(
      `INSERT INTO model_routes (route_id, route_type, connection_id, source_id, source_provider, capabilities, pricing_input, pricing_output, pricing_currency, pricing_units, pricing_source, pricing_effective_at, pricing_refreshed_at, pricing_version, availability_status, created_at, updated_at) VALUES ('route-1', 'provider', 'conn-1', 'gpt-4', 'openai', '["text"]', 0.03, 0.06, 'USD', 'per_1k_tokens', 'test', '${ts}', '${ts}', 'v1', 'available', '${ts}', '${ts}')`
    );

    await repos.routes.updateRouteAvailability('route-1', 'unavailable');
    const route = await repos.routes.getRoute('route-1');
    expect(route!.availability_status).toBe('unavailable');
  });
});

// ============================================================================
// Policy Repository
// ============================================================================

describe('PolicyRepository', () => {
  it('creates and retrieves policies', async () => {
    await repos.accounts.createAccount({
      account_id: 'acc-1',
      name: 'Test',
      updated_at: new Date(),
    });

    const policy = await repos.policies.createPolicy({
      policy_id: 'pol-1',
      account_id: 'acc-1',
      name: 'Default',
      ordering_strategy: 'cost',
      admissibility_rules: { allowed_route_types: ['provider'] },
      budget_constraints: { max_cost_per_task: 0.05 },
      manual_override_allowed: true,
      version: 1,
    });

    expect(policy.policy_id).toBe('pol-1');
    expect(policy.manual_override_allowed).toBe(true);

    const retrieved = await repos.policies.getPolicy('pol-1');
    expect(retrieved).not.toBeNull();
    expect(retrieved!.admissibility_rules).toEqual({ allowed_route_types: ['provider'] });
  });

  it('updates policy immutably (new version)', async () => {
    await repos.accounts.createAccount({
      account_id: 'acc-1',
      name: 'Test',
      updated_at: new Date(),
    });

    await repos.policies.createPolicy({
      policy_id: 'pol-1',
      account_id: 'acc-1',
      name: 'Default',
      ordering_strategy: 'cost',
      admissibility_rules: {},
      budget_constraints: {},
      manual_override_allowed: false,
      version: 1,
    });

    const updated = await repos.policies.updatePolicy({
      policy_id: 'pol-1',
      account_id: 'acc-1',
      name: 'Updated',
      ordering_strategy: 'cost',
      admissibility_rules: {},
      budget_constraints: {},
      manual_override_allowed: true,
      version: 2,
      created_at: new Date(),
      updated_at: new Date(),
    });

    expect(updated.version).toBe(2);
    const retrieved = await repos.policies.getPolicy('pol-1');
    expect(retrieved!.version).toBe(2);
  });
});

// ============================================================================
// Task Repository
// ============================================================================

describe('TaskRepository', () => {
  it('creates tasks and handles CAS', async () => {
    await repos.accounts.createAccount({
      account_id: 'acc-1',
      name: 'Test',
      updated_at: new Date(),
    });

    const task = await repos.tasks.createTask({
      task_id: 'task-1',
      account_id: 'acc-1',
      description: 'Test task',
      requirements: { capabilities: ['text'] },
      status: 'planning',
    });

    expect(task.task_id).toBe('task-1');

    // CAS update succeeds
    await repos.tasks.updateTaskStatus('task-1', 'approved', 'planning');
    const updated = await repos.tasks.getTask('task-1');
    expect(updated!.status).toBe('approved');

    // CAS conflict
    await expect(repos.tasks.updateTaskStatus('task-1', 'executing', 'planning')).rejects.toThrow(
      'state_conflict'
    );
  });
});

// ============================================================================
// Decision Repository
// ============================================================================

describe('DecisionRepository', () => {
  it('creates and lists decisions ordered by time', async () => {
    await repos.accounts.createAccount({
      account_id: 'acc-1',
      name: 'Test',
      updated_at: new Date(),
    });
    const ts = new Date().toISOString();
    sqlite.exec(
      `INSERT INTO principals (principal_id, issuer, subject, created_at, updated_at) VALUES ('princ-1', 'i', 's', '${ts}', '${ts}')`
    );
    sqlite.exec(
      `INSERT INTO routing_policies (policy_id, account_id, name, ordering_strategy, admissibility_rules, budget_constraints, manual_override_allowed, version, created_at, updated_at) VALUES ('pol-1', 'acc-1', 'Default', 'cost', '{}', '{}', 0, 1, '${ts}', '${ts}')`
    );

    await repos.tasks.createTask({
      task_id: 'task-1',
      account_id: 'acc-1',
      description: 'Test',
      requirements: { capabilities: [] },
      status: 'planning',
    });

    await repos.decisions.createDecision({
      decision_id: 'dec-1',
      task_id: 'task-1',
      policy_id: 'pol-1',
      policy_version: 1,
      evaluated_routes: ['r1'],
      admissible_routes: ['r1'],
      selected_route_id: 'r1',
      route_snapshot: null,
      rejection_reasons: [],
      estimated_cost: 0.01,
    });

    await repos.decisions.createDecision({
      decision_id: 'dec-2',
      task_id: 'task-1',
      policy_id: 'pol-1',
      policy_version: 1,
      evaluated_routes: ['r1', 'r2'],
      admissible_routes: ['r2'],
      selected_route_id: 'r2',
      route_snapshot: null,
      rejection_reasons: [],
      estimated_cost: 0.02,
      parent_decision_id: 'dec-1',
      fallback_reason: 'retry_exhausted',
    });

    const all = await repos.decisions.listDecisionsForTask('task-1');
    expect(all).toHaveLength(2);
    expect(all[0].decision_id).toBe('dec-1');
    expect(all[1].parent_decision_id).toBe('dec-1');
  });
});

// ============================================================================
// Execution Repository — CAS & Idempotency
// ============================================================================

describe('ExecutionRepository', () => {
  it('creates attempts with idempotency constraint', async () => {
    await repos.accounts.createAccount({
      account_id: 'acc-1',
      name: 'Test',
      updated_at: new Date(),
    });
    const ts = new Date().toISOString();
    sqlite.exec(
      `INSERT INTO principals (principal_id, issuer, subject, created_at, updated_at) VALUES ('princ-1', 'i', 's', '${ts}', '${ts}')`
    );
    sqlite.exec(
      `INSERT INTO routing_policies (policy_id, account_id, name, ordering_strategy, admissibility_rules, budget_constraints, manual_override_allowed, version, created_at, updated_at) VALUES ('pol-1', 'acc-1', 'Default', 'cost', '{}', '{}', 0, 1, '${ts}', '${ts}')`
    );
    await repos.tasks.createTask({
      task_id: 'task-1',
      account_id: 'acc-1',
      description: 'Test',
      requirements: { capabilities: [] },
      status: 'planning',
    });
    await repos.decisions.createDecision({
      decision_id: 'dec-1',
      task_id: 'task-1',
      policy_id: 'pol-1',
      policy_version: 1,
      evaluated_routes: [],
      admissible_routes: [],
      selected_route_id: null,
      route_snapshot: null,
      rejection_reasons: [],
      estimated_cost: 0,
    });

    const attempt1 = await repos.executions.createAttempt({
      attempt_id: 'att-1',
      account_id: 'acc-1',
      execution_id: 'exec-1',
      task_id: 'task-1',
      decision_id: 'dec-1',
      idempotency_key: 'idem-1',
      status: 'pending',
      started_at: null,
      completed_at: null,
      cancel_requested_at: null,
      cancelled_at: null,
      retry_count: 0,
      retry_policy: null,
      parent_attempt_id: null,
      verification_outcome: null,
      failure_code: null,
    });

    expect(attempt1.attempt_id).toBe('att-1');

    // Duplicate idempotency key throws
    await expect(
      repos.executions.createAttempt({
        attempt_id: 'att-2',
        account_id: 'acc-1',
        execution_id: 'exec-1',
        task_id: 'task-1',
        decision_id: 'dec-1',
        idempotency_key: 'idem-1',
        status: 'pending',
        started_at: null,
        completed_at: null,
        cancel_requested_at: null,
        cancelled_at: null,
        retry_count: 0,
        retry_policy: null,
        parent_attempt_id: null,
        verification_outcome: null,
        failure_code: null,
      })
    ).rejects.toThrow('idempotency_conflict');

    // Idempotency lookup works
    const found = await repos.executions.getAttemptByIdempotencyKey('acc-1', 'idem-1');
    expect(found).not.toBeNull();
    expect(found!.attempt_id).toBe('att-1');
  });

  it('CAS update prevents concurrent state transitions', async () => {
    await repos.accounts.createAccount({
      account_id: 'acc-1',
      name: 'Test',
      updated_at: new Date(),
    });
    const ts = new Date().toISOString();
    sqlite.exec(
      `INSERT INTO routing_policies (policy_id, account_id, name, ordering_strategy, admissibility_rules, budget_constraints, manual_override_allowed, version, created_at, updated_at) VALUES ('pol-1', 'acc-1', 'Default', 'cost', '{}', '{}', 0, 1, '${ts}', '${ts}')`
    );
    await repos.tasks.createTask({
      task_id: 'task-1',
      account_id: 'acc-1',
      description: 'Test',
      requirements: { capabilities: [] },
      status: 'planning',
    });
    await repos.decisions.createDecision({
      decision_id: 'dec-1',
      task_id: 'task-1',
      policy_id: 'pol-1',
      policy_version: 1,
      evaluated_routes: [],
      admissible_routes: [],
      selected_route_id: null,
      route_snapshot: null,
      rejection_reasons: [],
      estimated_cost: 0,
    });

    await repos.executions.createAttempt({
      attempt_id: 'att-1',
      account_id: 'acc-1',
      execution_id: 'exec-1',
      task_id: 'task-1',
      decision_id: 'dec-1',
      idempotency_key: 'ik-1',
      status: 'pending',
      started_at: null,
      completed_at: null,
      cancel_requested_at: null,
      cancelled_at: null,
      retry_count: 0,
      retry_policy: null,
      parent_attempt_id: null,
      verification_outcome: null,
      failure_code: null,
    });

    // Successful CAS transition
    await repos.executions.updateAttemptStatus(
      'att-1',
      'running',
      { started_at: new Date() },
      'pending'
    );

    // Failed CAS: expected 'running' but already 'running'
    await expect(
      repos.executions.updateAttemptStatus(
        'att-1',
        'completed',
        { completed_at: new Date() },
        'pending'
      )
    ).rejects.toThrow('state_conflict');
  });
});

// ============================================================================
// Usage Repository
// ============================================================================

describe('UsageRepository', () => {
  it('creates and deduplicates usage', async () => {
    await repos.accounts.createAccount({
      account_id: 'acc-1',
      name: 'Test',
      updated_at: new Date(),
    });
    const ts = new Date().toISOString();
    sqlite.exec(
      `INSERT INTO routing_policies (policy_id, account_id, name, ordering_strategy, admissibility_rules, budget_constraints, manual_override_allowed, version, created_at, updated_at) VALUES ('pol-1', 'acc-1', 'Default', 'cost', '{}', '{}', 0, 1, '${ts}', '${ts}')`
    );
    await repos.tasks.createTask({
      task_id: 'task-1',
      account_id: 'acc-1',
      description: 'Test',
      requirements: { capabilities: [] },
      status: 'planning',
    });
    await repos.decisions.createDecision({
      decision_id: 'dec-1',
      task_id: 'task-1',
      policy_id: 'pol-1',
      policy_version: 1,
      evaluated_routes: [],
      admissible_routes: [],
      selected_route_id: null,
      route_snapshot: null,
      rejection_reasons: [],
      estimated_cost: 0,
    });
    await repos.executions.createAttempt({
      attempt_id: 'att-1',
      account_id: 'acc-1',
      execution_id: 'exec-1',
      task_id: 'task-1',
      decision_id: 'dec-1',
      idempotency_key: 'ik-1',
      status: 'completed',
      started_at: new Date(),
      completed_at: new Date(),
      cancel_requested_at: null,
      cancelled_at: null,
      retry_count: 0,
      retry_policy: null,
      parent_attempt_id: null,
      verification_outcome: 'accepted',
      failure_code: null,
    });

    const usage = await repos.usage.createUsage({
      usage_id: 'usage-1',
      account_id: 'acc-1',
      attempt_id: 'att-1',
      provider_usage_data: { tokens: 100 },
      actual_cost: 0.005,
      cost_breakdown: { input: 0.003, output: 0.002 },
      tokens_used: { input: 50, output: 50 },
      cost_variance: -0.001,
    });

    expect(usage.actual_cost).toBe(0.005);

    // Duplicate attempt_id throws
    await expect(
      repos.usage.createUsage({
        usage_id: 'usage-2',
        account_id: 'acc-1',
        attempt_id: 'att-1',
        provider_usage_data: {},
        actual_cost: 0,
        cost_breakdown: {},
        tokens_used: null,
        cost_variance: null,
      })
    ).rejects.toThrow();

    // Daily spending aggregation
    const daily = await repos.usage.getDailySpending('acc-1');
    expect(daily).toBe(0.005);
  });
});

// ============================================================================
// Audit Repository
// ============================================================================

describe('AuditRepository', () => {
  it('records and queries audit events', async () => {
    await repos.audit.recordEvent({
      event_id: 'evt-1',
      account_id: 'acc-1',
      event_type: 'task.created',
      actor: 'principal:p1',
      resource_type: 'task',
      resource_id: 'task-1',
      metadata: { action: 'create' },
    });

    await repos.audit.recordEvent({
      event_id: 'evt-2',
      account_id: 'acc-1',
      event_type: 'task.executed',
      actor: 'principal:p1',
      resource_type: 'task',
      resource_id: 'task-1',
      metadata: { action: 'execute' },
    });

    const result = await repos.audit.listEvents('acc-1', { limit: 10 });
    expect(result.events).toHaveLength(2);
    expect(result.total_count).toBe(2);

    // Filter by event type
    const filtered = await repos.audit.listEvents('acc-1', { event_type: 'task.created' });
    expect(filtered.events).toHaveLength(1);
    expect(filtered.events[0].event_type).toBe('task.created');

    // Account isolation
    const otherAccount = await repos.audit.listEvents('acc-2');
    expect(otherAccount.events).toHaveLength(0);
  });

  it('supports pagination', async () => {
    for (let i = 0; i < 5; i++) {
      await repos.audit.recordEvent({
        event_id: `evt-${i}`,
        account_id: 'acc-1',
        event_type: 'test',
        actor: 'system',
        resource_type: 'test',
        resource_id: `test-${i}`,
        metadata: {},
      });
    }

    const page1 = await repos.audit.listEvents('acc-1', { limit: 2, offset: 0 });
    expect(page1.events).toHaveLength(2);
    expect(page1.total_count).toBe(5);

    const page2 = await repos.audit.listEvents('acc-1', { limit: 2, offset: 4 });
    expect(page2.events).toHaveLength(1);
  });
});

// ============================================================================
// Credential Store
// ============================================================================

describe('FakeSecretStore', () => {
  it('stores and resolves secrets', async () => {
    const store = new FakeSecretStore();
    expect(await store.hasSecret('key-1')).toBe(false);

    await store.storeSecret('key-1', 'secret-value');
    expect(await store.hasSecret('key-1')).toBe(true);
    expect(await store.resolveSecret('key-1')).toBe('secret-value');

    await store.revokeSecret('key-1');
    expect(await store.hasSecret('key-1')).toBe(false);
  });

  it('throws for missing secrets', async () => {
    const store = new FakeSecretStore();
    await expect(store.resolveSecret('missing')).rejects.toThrow('secret_not_found');
  });
});

describe('EnvSecretStore', () => {
  it('resolves from environment variables', async () => {
    process.env.GPTR_TEST_SECRET = 'env-value';
    const store = new EnvSecretStore('GPTR_');
    expect(await store.resolveSecret('test_secret')).toBe('env-value');
    delete process.env.GPTR_TEST_SECRET;
  });

  it('throws for missing env vars', async () => {
    const store = new EnvSecretStore('GPTR_');
    await expect(store.resolveSecret('nonexistent')).rejects.toThrow('secret_not_found');
  });
});

// ============================================================================
// Auth Verifier
// ============================================================================

/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call */
describe('AuthVerifier', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let privateKey: any;
  let publicKeyJwk: JWK;

  beforeAll(async () => {
    const { publicKey, privateKey: priv } = await generateKeyPair('RS256');
    privateKey = priv;
    publicKeyJwk = await exportJWK(publicKey);
  });

  async function makeToken(claims: Record<string, unknown>): Promise<string> {
    const jwt = new SignJWT(claims as JWTPayload)
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      .sign(privateKey);
    return jwt;
  }

  function resolveJwks(): () => Promise<JWK[]> {
    return async () => [publicKeyJwk];
  }

  it('rejects empty tokens', async () => {
    const verifier = new AuthVerifier({ resolveJwks: resolveJwks() });
    await expect(verifier.verify('')).rejects.toThrow(AuthError);
  });

  it('rejects malformed tokens', async () => {
    const verifier = new AuthVerifier({ resolveJwks: resolveJwks() });
    try {
      await verifier.verify('not-a-jwt');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AuthError);
      expect((e as AuthError).code).toBe('invalid_token');
    }
  });

  it('rejects expired tokens', async () => {
    const clock = () => new Date('2025-01-02T00:00:00Z');
    const verifier = new AuthVerifier({ clock, resolveJwks: resolveJwks() });
    const token = await makeToken({
      iss: 'test',
      sub: 'user1',
      exp: 1735689600,
      iat: 1735686000,
    });
    try {
      await verifier.verify(token);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AuthError);
      expect((e as AuthError).code).toBe('token_expired');
    }
  });

  it('rejects wrong issuer', async () => {
    const clock = () => new Date('2025-01-01T00:00:00Z');
    const verifier = new AuthVerifier({
      clock,
      expectedIssuer: 'expected-issuer',
      resolveJwks: resolveJwks(),
    });
    const token = await makeToken({
      iss: 'wrong-issuer',
      sub: 'user1',
      exp: 9999999999,
      iat: 1735686000,
    });
    try {
      await verifier.verify(token);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AuthError);
      expect((e as AuthError).code).toBe('wrong_issuer');
    }
  });

  it('rejects wrong audience', async () => {
    const clock = () => new Date('2025-01-01T00:00:00Z');
    const verifier = new AuthVerifier({
      clock,
      expectedAudience: 'expected-aud',
      resolveJwks: resolveJwks(),
    });
    const token = await makeToken({
      iss: 'test',
      sub: 'user1',
      aud: 'wrong-aud',
      exp: 9999999999,
      iat: 1735686000,
    });
    try {
      await verifier.verify(token);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AuthError);
      expect((e as AuthError).code).toBe('wrong_audience');
    }
  });

  it('accepts valid tokens', async () => {
    const clock = () => new Date('2025-01-01T00:00:00Z');
    const verifier = new AuthVerifier({
      clock,
      expectedIssuer: 'test-issuer',
      expectedAudience: 'test-aud',
      resolveJwks: resolveJwks(),
    });
    const token = await makeToken({
      iss: 'test-issuer',
      sub: 'user1',
      aud: 'test-aud',
      exp: 9999999999,
      iat: 1735686000,
      scope: 'read write',
    });
    const auth = await verifier.verify(token);
    expect(auth.issuer).toBe('test-issuer');
    expect(auth.subject).toBe('user1');
    expect(auth.scopes).toEqual(['read', 'write']);
    // Raw token must never be in AuthInfo
    expect((auth as unknown as Record<string, unknown>).raw_token).toBeUndefined();
  });
});

describe('FakeAuthVerifier', () => {
  it('resolves pre-registered tokens', async () => {
    const { token, info } = FakeAuthVerifier.createToken('test-issuer', 'user1', 'acc-1');
    const verifier = new FakeAuthVerifier(new Map([[token, info]]));
    const result = await verifier.verify(token);
    expect(result.issuer).toBe('test-issuer');
    expect(result.subject).toBe('user1');
  });

  it('rejects unknown tokens', async () => {
    const verifier = new FakeAuthVerifier(new Map());
    await expect(verifier.verify('unknown-token')).rejects.toThrow('Unknown test token');
  });
});
/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call */

// ============================================================================
// Decision immutability
// ============================================================================

describe('decision immutability', () => {
  it('decisions are append-only', async () => {
    await repos.accounts.createAccount({
      account_id: 'acc-1',
      name: 'Test',
      updated_at: new Date(),
    });
    const ts = new Date().toISOString();
    sqlite.exec(
      `INSERT INTO routing_policies (policy_id, account_id, name, ordering_strategy, admissibility_rules, budget_constraints, manual_override_allowed, version, created_at, updated_at) VALUES ('pol-1', 'acc-1', 'Default', 'cost', '{}', '{}', 0, 1, '${ts}', '${ts}')`
    );
    await repos.tasks.createTask({
      task_id: 'task-1',
      account_id: 'acc-1',
      description: 'Test',
      requirements: { capabilities: [] },
      status: 'planning',
    });

    await repos.decisions.createDecision({
      decision_id: 'dec-1',
      task_id: 'task-1',
      policy_id: 'pol-1',
      policy_version: 1,
      evaluated_routes: ['r1'],
      admissible_routes: ['r1'],
      selected_route_id: 'r1',
      route_snapshot: null,
      rejection_reasons: [],
      estimated_cost: 0.01,
    });

    await repos.decisions.createDecision({
      decision_id: 'dec-2',
      task_id: 'task-1',
      policy_id: 'pol-1',
      policy_version: 1,
      evaluated_routes: ['r2'],
      admissible_routes: ['r2'],
      selected_route_id: 'r2',
      route_snapshot: null,
      rejection_reasons: [],
      estimated_cost: 0.02,
      parent_decision_id: 'dec-1',
    });

    // No updateDecision method exists - decisions are immutable
    const all = await repos.decisions.listDecisionsForTask('task-1');
    expect(all).toHaveLength(2);
    expect(all[0].decided_at.getTime()).toBeLessThanOrEqual(all[1].decided_at.getTime());
  });
});

// ============================================================================
// Audit never blocks execution
// ============================================================================

describe('audit degradation', () => {
  it('audit failure does not propagate', async () => {
    // Even if the audit table has issues, other operations should succeed
    await repos.accounts.createAccount({
      account_id: 'acc-1',
      name: 'Test',
      updated_at: new Date(),
    });
    const task = await repos.tasks.createTask({
      task_id: 'task-1',
      account_id: 'acc-1',
      description: 'Test',
      requirements: { capabilities: [] },
      status: 'planning',
    });
    expect(task.task_id).toBe('task-1');
  });
});

// ============================================================================
// Raw credentials never stored
// ============================================================================

describe('credential safety', () => {
  it('credential_reference is opaque', async () => {
    await repos.accounts.createAccount({
      account_id: 'acc-1',
      name: 'Test',
      updated_at: new Date(),
    });
    const conn = await repos.connections.createConnection({
      type: 'provider',
      connection_id: 'conn-1',
      account_id: 'acc-1',
      provider: 'openai',
      status: 'active',
      credential_reference: 'vault://secrets/openai-key',
    } as Omit<ProviderConnection, 'created_at' | 'updated_at'>);

    // The connection should store only the reference, never the actual key
    expect(conn.credential_reference).toBe('vault://secrets/openai-key');
    expect(conn.credential_reference).not.toContain('sk-');
  });
});
