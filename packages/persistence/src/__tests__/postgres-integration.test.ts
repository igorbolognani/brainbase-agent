import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const CONTAINER_NAME = 'gptrouter-test-pg';
const PORT = 5433;
const DATABASE_URL = `postgresql://postgres:test@localhost:${PORT}/gptrouter_test`;
const ROOT = new URL('..', import.meta.url).pathname;

let prisma: PrismaClient;

function dockerRun() {
  execSync(
    `docker run --rm -d --name ${CONTAINER_NAME} -p ${PORT}:5432 -e POSTGRES_PASSWORD=test -e POSTGRES_DB=gptrouter_test postgres:16-alpine`,
    { stdio: 'pipe' }
  );
}

function dockerStop() {
  try {
    execSync(`docker stop ${CONTAINER_NAME}`, { stdio: 'pipe' });
  } catch {
    // already stopped
  }
}

async function waitForPostgres(maxAttempts = 30, delayMs = 1000): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      execSync(`docker exec ${CONTAINER_NAME} pg_isready -U postgres -d gptrouter_test`, {
        stdio: 'pipe',
      });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error('PostgreSQL did not become ready in time');
}

function runMigrations() {
  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL },
    cwd: ROOT,
    stdio: 'pipe',
  });
}

let dockerAvailable = false;
try {
  execSync('docker info', { stdio: 'pipe' });
  dockerAvailable = true;
} catch {
  // docker not available
}

if (!dockerAvailable) {
  console.log('POSTGRES INTEGRATION TEST: NOT RUN');
}

describe.skipIf(!dockerAvailable)('PostgreSQL integration', () => {
  beforeAll(async () => {
    dockerRun();
    await waitForPostgres();
    runMigrations();
    const adapter = new PrismaPg({ connectionString: DATABASE_URL });
    prisma = new PrismaClient({ adapter });
  }, 60_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    dockerStop();
  });

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  const accountA = { account_id: 'acc-a', name: 'Account A' };
  const accountB = { account_id: 'acc-b', name: 'Account B' };

  async function seedAccount(acc: { account_id: string; name: string }) {
    await prisma.account.create({ data: acc });
  }

  // -----------------------------------------------------------------------
  // Account, Principal, Membership
  // -----------------------------------------------------------------------

  describe('account, principal, membership', () => {
    it('creates account, principal, and membership', async () => {
      await seedAccount(accountA);

      const principal = await prisma.principal.create({
        data: { principal_id: 'princ-1', issuer: 'test-issuer', subject: 'user1' },
      });
      expect(principal.issuer).toBe('test-issuer');

      const membership = await prisma.accountMembership.create({
        data: {
          membership_id: 'mem-1',
          account_id: accountA.account_id,
          principal_id: principal.principal_id,
          role: 'owner',
          status: 'active',
        },
      });
      expect(membership.role).toBe('owner');

      const found = await prisma.accountMembership.findUnique({
        where: {
          account_id_principal_id: {
            account_id: accountA.account_id,
            principal_id: principal.principal_id,
          },
        },
      });
      expect(found).not.toBeNull();
    });

    it('enforces principal issuer+subject uniqueness', async () => {
      await expect(
        prisma.principal.create({
          data: { principal_id: 'princ-dup', issuer: 'test-issuer', subject: 'user1' },
        })
      ).rejects.toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // Provider and Gateway connections (distinct types)
  // -----------------------------------------------------------------------

  describe('connections', () => {
    it('creates provider and gateway connections', async () => {
      const providerConn = await prisma.providerConnection.create({
        data: {
          connection_id: 'pc-1',
          account_id: accountA.account_id,
          provider: 'openai',
          status: 'active',
          credential_reference: 'vault://openai',
        },
      });
      expect(providerConn.provider).toBe('openai');

      const gatewayConn = await prisma.gatewayConnection.create({
        data: {
          connection_id: 'gc-1',
          account_id: accountA.account_id,
          gateway_url: 'https://openrouter.ai',
          gateway_type: 'openrouter',
          status: 'active',
          credential_reference: 'vault://openrouter',
        },
      });
      expect(gatewayConn.gateway_type).toBe('openrouter');

      const providerList = await prisma.providerConnection.findMany({
        where: { account_id: accountA.account_id },
      });
      const gatewayList = await prisma.gatewayConnection.findMany({
        where: { account_id: accountA.account_id },
      });
      expect(providerList).toHaveLength(1);
      expect(gatewayList).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------------------
  // Model Route
  // -----------------------------------------------------------------------

  describe('model route', () => {
    it('creates a route linked to a provider connection', async () => {
      const route = await prisma.modelRoute.create({
        data: {
          route_id: 'route-1',
          route_type: 'provider',
          provider_connection_id: 'pc-1',
          source_id: 'gpt-4',
          source_provider: 'openai',
          capabilities: ['text'],
          pricing_input: 0.03,
          pricing_output: 0.06,
          pricing_source: 'openai',
          pricing_effective_at: new Date(),
          pricing_refreshed_at: new Date(),
          pricing_version: 'v1',
          availability_status: 'available',
        },
      });
      expect(route.source_id).toBe('gpt-4');
      expect(route.availability_status).toBe('available');
    });
  });

  // -----------------------------------------------------------------------
  // Task, Decision
  // -----------------------------------------------------------------------

  describe('task and decision', () => {
    it('creates task and routing decision', async () => {
      const policy = await prisma.routingPolicy.create({
        data: {
          policy_id: 'pol-int-1',
          account_id: accountA.account_id,
          name: 'Default',
          ordering_strategy: 'cost',
          admissibility_rules: {},
          budget_constraints: {},
          manual_override_allowed: false,
          version: 1,
        },
      });

      const task = await prisma.task.create({
        data: {
          task_id: 'task-int-1',
          account_id: accountA.account_id,
          description: 'Integration test task',
          requirements: { capabilities: ['text'] },
          status: 'planning',
        },
      });
      expect(task.status).toBe('planning');

      const decision = await prisma.routingDecision.create({
        data: {
          decision_id: 'dec-int-1',
          task_id: task.task_id,
          policy_id: policy.policy_id,
          policy_version: 1,
          evaluated_routes: ['route-1'],
          admissible_routes: ['route-1'],
          selected_route_id: 'route-1',
          rejection_reasons: [],
          estimated_cost: 0.01,
        },
      });
      expect(decision.selected_route_id).toBe('route-1');
    });
  });

  // -----------------------------------------------------------------------
  // Execution with idempotency
  // -----------------------------------------------------------------------

  describe('execution idempotency', () => {
    it('same key returns same execution, different key creates new', async () => {
      const exec1 = await prisma.execution.create({
        data: {
          execution_id: 'exec-int-1',
          account_id: accountA.account_id,
          task_id: 'task-int-1',
          root_decision_id: 'dec-int-1',
          idempotency_key: 'idem-shared',
          status: 'pending',
        },
      });
      expect(exec1.execution_id).toBe('exec-int-1');

      // Same idempotency key => conflict
      await expect(
        prisma.execution.create({
          data: {
            execution_id: 'exec-int-2',
            account_id: accountA.account_id,
            task_id: 'task-int-1',
            root_decision_id: 'dec-int-1',
            idempotency_key: 'idem-shared',
            status: 'pending',
          },
        })
      ).rejects.toThrow();

      // Different key => succeeds
      const exec3 = await prisma.execution.create({
        data: {
          execution_id: 'exec-int-3',
          account_id: accountA.account_id,
          task_id: 'task-int-1',
          root_decision_id: 'dec-int-1',
          idempotency_key: 'idem-other',
          status: 'pending',
        },
      });
      expect(exec3.execution_id).not.toBe(exec1.execution_id);
    });
  });

  // -----------------------------------------------------------------------
  // Child attempts (retry/fallback)
  // -----------------------------------------------------------------------

  describe('child attempts', () => {
    it('creates parent and child attempts', async () => {
      const parent = await prisma.executionAttempt.create({
        data: {
          attempt_id: 'att-parent',
          execution_id: 'exec-int-1',
          account_id: accountA.account_id,
          task_id: 'task-int-1',
          decision_id: 'dec-int-1',
          idempotency_key: 'att-idem-parent',
          status: 'failed',
          retry_count: 0,
        },
      });
      expect(parent.attempt_id).toBe('att-parent');

      const child = await prisma.executionAttempt.create({
        data: {
          attempt_id: 'att-child',
          execution_id: 'exec-int-1',
          account_id: accountA.account_id,
          task_id: 'task-int-1',
          decision_id: 'dec-int-1',
          idempotency_key: 'att-idem-child',
          status: 'running',
          retry_count: 1,
          parent_attempt_id: parent.attempt_id,
        },
      });
      expect(child.parent_attempt_id).toBe('att-parent');

      const attempts = await prisma.executionAttempt.findMany({
        where: { execution_id: 'exec-int-1' },
        orderBy: { created_at: 'asc' },
      });
      expect(attempts).toHaveLength(2);
    });
  });

  // -----------------------------------------------------------------------
  // Usage record with null actual_cost
  // -----------------------------------------------------------------------

  describe('usage record', () => {
    it('creates usage with null actual_cost', async () => {
      const usage = await prisma.usageRecord.create({
        data: {
          usage_id: 'usage-int-1',
          account_id: accountA.account_id,
          attempt_id: 'att-parent',
          provider_usage_data: { tokens: 100 },
          actual_cost: null,
          cost_breakdown: {},
        },
      });
      expect(usage.actual_cost).toBeNull();

      const fetched = await prisma.usageRecord.findUnique({ where: { usage_id: 'usage-int-1' } });
      expect(fetched!.actual_cost).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Audit event
  // -----------------------------------------------------------------------

  describe('audit event', () => {
    it('creates and queries audit events', async () => {
      await prisma.auditEvent.create({
        data: {
          event_id: 'evt-int-1',
          account_id: accountA.account_id,
          event_type: 'task.created',
          actor: 'principal:princ-1',
          resource_type: 'task',
          resource_id: 'task-int-1',
          metadata: { action: 'create' },
        },
      });

      const events = await prisma.auditEvent.findMany({
        where: { account_id: accountA.account_id },
      });
      expect(events).toHaveLength(1);
      expect(events[0].event_type).toBe('task.created');
    });
  });

  // -----------------------------------------------------------------------
  // Account isolation
  // -----------------------------------------------------------------------

  describe('account isolation', () => {
    it('account A cannot see account B data', async () => {
      await seedAccount(accountB);

      // Account B creates a task
      await prisma.task.create({
        data: {
          task_id: 'task-b-only',
          account_id: accountB.account_id,
          description: 'B private task',
          requirements: {},
          status: 'planning',
        },
      });

      const tasksA = await prisma.task.findMany({ where: { account_id: accountA.account_id } });
      const tasksB = await prisma.task.findMany({ where: { account_id: accountB.account_id } });

      expect(tasksA.every((t) => t.account_id === accountA.account_id)).toBe(true);
      expect(tasksB).toHaveLength(1);
      expect(tasksB[0].task_id).toBe('task-b-only');

      // Connection isolation
      await prisma.providerConnection.create({
        data: {
          connection_id: 'pc-b-only',
          account_id: accountB.account_id,
          provider: 'anthropic',
          status: 'active',
          credential_reference: 'vault://anthropic',
        },
      });

      const connsA = await prisma.providerConnection.findMany({
        where: { account_id: accountA.account_id },
      });
      const connsB = await prisma.providerConnection.findMany({
        where: { account_id: accountB.account_id },
      });
      expect(connsA.every((c) => c.account_id === accountA.account_id)).toBe(true);
      expect(connsB).toHaveLength(1);

      // Audit isolation
      await prisma.auditEvent.create({
        data: {
          event_id: 'evt-b-only',
          account_id: accountB.account_id,
          event_type: 'connection.created',
          actor: 'system',
          metadata: {},
        },
      });

      const auditA = await prisma.auditEvent.findMany({
        where: { account_id: accountA.account_id },
      });
      const auditB = await prisma.auditEvent.findMany({
        where: { account_id: accountB.account_id },
      });
      expect(auditA.every((e) => e.account_id === accountA.account_id)).toBe(true);
      expect(auditB.some((e) => e.event_id === 'evt-b-only')).toBe(true);
    });
  });
});
