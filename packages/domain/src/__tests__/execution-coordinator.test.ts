import { describe, expect, it } from 'vitest';
import type {
  Account,
  AccountMembership,
  AuthorizedExecutionContext,
  AuditEvent,
  DecisionRepository,
  ExecutionAttempt,
  ExecutionRepository,
  PolicyRepository,
  Principal,
  RoutingDecision,
  RoutingPolicy,
  Task,
  TaskRepository,
  UsageRecord,
  UsageRepository,
} from '@gptrouter/contracts';
import {
  BudgetEnforcer,
  DeterministicVerifier,
  ExecutionCoordinator,
  type ExecutionOutput,
} from '../index.js';

const now = new Date('2026-08-20T12:00:00.000Z');
const accountId = 'account-test';

function context(): AuthorizedExecutionContext {
  const principal: Principal = {
    principal_id: 'principal-test',
    issuer: 'issuer-test',
    subject: 'subject-test',
    created_at: now,
    updated_at: now,
  };
  const account: Account = {
    account_id: accountId,
    name: 'Synthetic test account',
    created_at: now,
    updated_at: now,
  };
  const membership: AccountMembership = {
    membership_id: 'membership-test',
    account_id: accountId,
    principal_id: principal.principal_id,
    role: 'member',
    status: 'active',
    created_at: now,
    updated_at: now,
  };
  return { principal, account, membership };
}

function output(): ExecutionOutput {
  return {
    provider_usage_data: { execution_mode: 'synthetic' },
    actual_cost: 0,
    cost_breakdown: { execution_mode: 'synthetic' },
    tokens_used: { input: 0, output: 0 },
  };
}

function harness() {
  const task: Task = {
    task_id: 'task-test',
    account_id: accountId,
    description: 'test task',
    requirements: { capabilities: ['text'] },
    status: 'planning',
    created_at: now,
  };
  const decision: RoutingDecision = {
    decision_id: 'decision-test',
    task_id: task.task_id,
    policy_id: 'policy-test',
    policy_version: 1,
    evaluated_routes: ['route-test'],
    admissible_routes: ['route-test'],
    selected_route_id: 'route-test',
    route_snapshot: {
      route_id: 'route-test',
      route_type: 'provider',
      connection_id: 'connection-test',
      source_id: 'synthetic-test-route',
      source_provider: 'synthetic-provider',
      pricing: {
        input_cost_per_1k_tokens: 0.001,
        output_cost_per_1k_tokens: 0.002,
        currency: 'USD',
        units: 'per_1k_tokens',
        source: 'synthetic-fixture',
        effective_at: now,
        refreshed_at: now,
        version: 'synthetic-v1',
      },
      policy_version: 1,
    },
    rejection_reasons: [],
    estimated_cost: 0.003,
    decided_at: now,
  };
  const policy: RoutingPolicy = {
    policy_id: 'policy-test',
    account_id: accountId,
    name: 'test policy',
    ordering_strategy: 'cost',
    admissibility_rules: {},
    budget_constraints: { max_cost_per_task: 0.01, daily_cap: 1, monthly_cap: 10 },
    manual_override_allowed: false,
    version: 1,
    created_at: now,
    updated_at: now,
  };
  const attempts = new Map<string, ExecutionAttempt>();
  const usageRecords = new Map<string, UsageRecord>();
  const auditEvents: AuditEvent[] = [];
  let currentTask = task;
  let invocations = 0;

  const tasks: TaskRepository = {
    async getTask() {
      return { ...currentTask };
    },
    async listTasks() {
      return [{ ...currentTask }];
    },
    async createTask(value) {
      currentTask = { ...value, created_at: now };
      return { ...currentTask };
    },
    async updateTaskStatus(_taskId, status) {
      const allowed: Record<Task['status'], Task['status'][]> = {
        planning: ['approved'],
        approved: ['executing'],
        executing: ['completed', 'failed'],
        completed: [],
        failed: [],
        cancelled: [],
      };
      if (currentTask.status !== status && !allowed[currentTask.status].includes(status)) {
        throw new Error('illegal_task_transition');
      }
      currentTask = { ...currentTask, status };
    },
  };
  const decisions: DecisionRepository = {
    async getDecision() {
      return { ...decision };
    },
    async createDecision(value) {
      return { ...value, decided_at: now };
    },
    async listDecisionsForTask() {
      return [{ ...decision }];
    },
  };
  const executions: ExecutionRepository = {
    async getAttempt(attemptId) {
      const attempt = attempts.get(attemptId);
      return attempt ? { ...attempt } : null;
    },
    async getAttemptByIdempotencyKey(_account, key) {
      const attempt = [...attempts.values()].find((value) => value.idempotency_key === key);
      return attempt ? { ...attempt } : null;
    },
    async createAttempt(value) {
      const duplicate = [...attempts.values()].find(
        (attempt) =>
          attempt.account_id === value.account_id &&
          attempt.idempotency_key === value.idempotency_key
      );
      if (duplicate) {
        const error = new Error('idempotency_conflict') as Error & { code: string };
        error.code = 'idempotency_conflict';
        throw error;
      }
      const created = { ...value, created_at: now };
      attempts.set(created.attempt_id, created);
      return { ...created };
    },
    async listAttemptsForTask(taskId) {
      return [...attempts.values()].filter((attempt) => attempt.task_id === taskId);
    },
    async updateAttemptStatus(attemptId, status, updates) {
      const attempt = attempts.get(attemptId);
      if (!attempt) throw new Error('attempt_not_found');
      const allowed: Record<ExecutionAttempt['status'], ExecutionAttempt['status'][]> = {
        pending: ['running', 'cancelled'],
        running: ['completed', 'failed', 'cancel_requested', 'cancelled'],
        completed: [],
        failed: [],
        cancel_requested: ['cancelled', 'completed'],
        cancelled: [],
      };
      if (attempt.status !== status && !allowed[attempt.status].includes(status)) {
        throw new Error('illegal_attempt_transition');
      }
      attempts.set(attemptId, { ...attempt, ...updates, status });
    },
  };
  const usage: UsageRepository = {
    async getUsage(usageId) {
      return usageRecords.get(usageId) ?? null;
    },
    async getUsageForAttempt(attemptId) {
      return [...usageRecords.values()].find((record) => record.attempt_id === attemptId) ?? null;
    },
    async createUsage(value) {
      const created = { ...value, reconciled_at: now };
      usageRecords.set(created.usage_id, created);
      return { ...created };
    },
    async listUsageForAccount() {
      return [...usageRecords.values()];
    },
    async getDailySpending() {
      return 0;
    },
    async getMonthlySpending() {
      return 0;
    },
  };
  const audit = {
    async recordEvent(value: Omit<AuditEvent, 'timestamp'>) {
      const created = { ...value, timestamp: now };
      auditEvents.push(created);
      return created;
    },
    async listEvents() {
      return { events: auditEvents, total_count: auditEvents.length };
    },
  };
  const repositories = {
    tasks,
    decisions,
    policies: {
      async getPolicy() {
        return policy;
      },
      async getDefaultPolicy() {
        return policy;
      },
      async listPolicies() {
        return [policy];
      },
      async createPolicy(value: Omit<RoutingPolicy, 'created_at' | 'updated_at'>) {
        return { ...value, created_at: now, updated_at: now };
      },
      async updatePolicy(value: RoutingPolicy) {
        return value;
      },
    } as RoutingPolicyRepositoryForTest,
    executions,
    usage,
    audit,
  };
  const coordinator = new ExecutionCoordinator({
    repositories,
    budgetEnforcer: new BudgetEnforcer(usage),
    executor: {
      async execute() {
        invocations += 1;
        return output();
      },
    },
    verifier: new DeterministicVerifier(),
    clock: () => now,
  });
  return {
    coordinator,
    context: context(),
    policy,
    decision,
    attempts,
    auditEvents,
    invocations: () => invocations,
    executions,
    currentTask: () => currentTask,
  };
}

type RoutingPolicyRepositoryForTest = {
  getPolicy: PolicyRepository['getPolicy'];
  getDefaultPolicy: PolicyRepository['getDefaultPolicy'];
  listPolicies: PolicyRepository['listPolicies'];
  createPolicy: PolicyRepository['createPolicy'];
  updatePolicy: PolicyRepository['updatePolicy'];
};

describe('ExecutionCoordinator invariants', () => {
  it('re-checks the current budget after planning and before dispatch', async () => {
    const fixture = harness();
    fixture.policy.budget_constraints.max_cost_per_task = 0;

    await expect(
      fixture.coordinator.runTask(fixture.context, {
        task_id: 'task-test',
        decision_id: 'decision-test',
        idempotency_key: 'budget-changed',
      })
    ).rejects.toMatchObject({ code: 'budget_denied' });
    expect(fixture.invocations()).toBe(0);
    expect(fixture.currentTask().status).toBe('approved');
  });

  it('rejects a missing route snapshot without creating an attempt', async () => {
    const fixture = harness();
    fixture.decision.route_snapshot = null;

    await expect(
      fixture.coordinator.runTask(fixture.context, {
        task_id: 'task-test',
        decision_id: 'decision-test',
        idempotency_key: 'missing-snapshot',
      })
    ).rejects.toMatchObject({ code: 'route_snapshot_missing' });
    expect(fixture.attempts.size).toBe(0);
    expect(fixture.invocations()).toBe(0);
  });

  it('keeps state transitions owned by the repositories/coordinator', async () => {
    const fixture = harness();
    const result = await fixture.coordinator.runTask(fixture.context, {
      task_id: 'task-test',
      decision_id: 'decision-test',
      idempotency_key: 'state-machine',
    });
    expect(result.status).toBe('completed');
    const attemptId = result.attempt_id;

    await expect(fixture.executions.updateAttemptStatus(attemptId, 'running', {})).rejects.toThrow(
      'illegal_attempt_transition'
    );
    await expect(
      fixture.coordinator.runTask(fixture.context, {
        task_id: 'task-test',
        decision_id: 'decision-test',
        idempotency_key: 'second-state-machine',
      })
    ).rejects.toMatchObject({ code: 'invalid_task_state' });
  });

  it('records successful audit order and does not double reconcile on replay', async () => {
    const fixture = harness();
    const request = {
      task_id: 'task-test',
      decision_id: 'decision-test',
      idempotency_key: 'audit-order',
    };
    const first = await fixture.coordinator.runTask(fixture.context, request);
    const replay = await fixture.coordinator.runTask(fixture.context, request);

    expect(replay.replayed).toBe(true);
    expect(fixture.auditEvents.map((event) => event.event_type)).toEqual([
      'task.execution.approved',
      'task.execution.started',
      'usage.reconciled',
      'task.execution.completed',
    ]);
    expect(first.usage_id).toBe(replay.usage_id);
  });
});
