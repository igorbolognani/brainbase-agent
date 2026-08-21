import { eq, and, sql, desc, asc } from 'drizzle-orm';
import type {
  AccountRepository,
  PrincipalRepository,
  MembershipRepository,
  ConnectionRepository,
  RouteRepository,
  PolicyRepository,
  TaskRepository,
  DecisionRepository,
  ExecutionRepository,
  UsageRepository,
  AuditRepository,
  Account,
  AccountMembership,
  Connection,
  Execution,
  ModelRoute,
  Principal,
  RoutingPolicy,
  Task,
  RoutingDecision,
  ExecutionAttempt,
  UsageRecord,
  AuditEvent,
  AvailabilityStatus,
} from '@gptrouter/contracts';
import type { DrizzleDB } from './database.js';
import {
  accounts,
  principals,
  account_memberships,
  connections,
  model_routes,
  routing_policies,
  tasks,
  routing_decisions,
  executions,
  execution_attempts,
  usage_records,
  audit_events,
} from './schema.js';
import {
  rowToAccount,
  rowToPrincipal,
  rowToMembership,
  rowToConnection,
  rowToRoute,
  rowToPolicy,
  rowToTask,
  rowToDecision,
  rowToExecution,
  rowToAttempt,
  rowToUsage,
  rowToAudit,
} from './converters.js';

function now(): string {
  return new Date().toISOString();
}

// ============================================================================
// Principal Repository
// ============================================================================

export class PrismaPrincipalRepository implements PrincipalRepository {
  constructor(private readonly db: DrizzleDB) {}

  async getPrincipal(principal_id: string): Promise<Principal | null> {
    const row = this.db
      .select()
      .from(principals)
      .where(eq(principals.principal_id, principal_id))
      .get();
    return row ? rowToPrincipal(row) : null;
  }

  async getPrincipalBySubject(issuer: string, subject: string): Promise<Principal | null> {
    const row = this.db
      .select()
      .from(principals)
      .where(and(eq(principals.issuer, issuer), eq(principals.subject, subject)))
      .get();
    return row ? rowToPrincipal(row) : null;
  }
}

// ============================================================================
// Account Repository
// ============================================================================

export class PrismaAccountRepository implements AccountRepository {
  constructor(private readonly db: DrizzleDB) {}

  async getAccount(account_id: string): Promise<Account | null> {
    const row = this.db.select().from(accounts).where(eq(accounts.account_id, account_id)).get();
    return row ? rowToAccount(row) : null;
  }

  async createAccount(account: Omit<Account, 'created_at'>): Promise<Account> {
    const ts = now();
    this.db
      .insert(accounts)
      .values({
        account_id: account.account_id,
        name: account.name,
        created_at: ts,
        updated_at: ts,
      })
      .run();
    return { ...account, created_at: new Date(ts), updated_at: new Date(ts) };
  }
}

// ============================================================================
// Membership Repository
// ============================================================================

export class PrismaMembershipRepository implements MembershipRepository {
  constructor(private readonly db: DrizzleDB) {}

  async getMembership(account_id: string, principal_id: string): Promise<AccountMembership | null> {
    const row = this.db
      .select()
      .from(account_memberships)
      .where(
        and(
          eq(account_memberships.account_id, account_id),
          eq(account_memberships.principal_id, principal_id)
        )
      )
      .get();
    return row ? rowToMembership(row) : null;
  }

  async listMembershipsForPrincipal(principal_id: string): Promise<AccountMembership[]> {
    const rows = this.db
      .select()
      .from(account_memberships)
      .where(eq(account_memberships.principal_id, principal_id))
      .all();
    return rows.map(rowToMembership);
  }
}

// ============================================================================
// Connection Repository
// ============================================================================

export class PrismaConnectionRepository implements ConnectionRepository {
  constructor(private readonly db: DrizzleDB) {}

  async listConnections(account_id: string): Promise<Connection[]> {
    const rows = this.db
      .select()
      .from(connections)
      .where(eq(connections.account_id, account_id))
      .all();
    return rows.map(rowToConnection);
  }

  async getConnection(connection_id: string): Promise<Connection | null> {
    const row = this.db
      .select()
      .from(connections)
      .where(eq(connections.connection_id, connection_id))
      .get();
    return row ? rowToConnection(row) : null;
  }

  async createConnection(
    connection: Omit<Connection, 'created_at' | 'updated_at'>
  ): Promise<Connection> {
    const ts = now();
    const conn = connection as Connection;
    const values: typeof connections.$inferInsert = {
      connection_id: conn.connection_id,
      account_id: conn.account_id,
      type: conn.type,
      provider: conn.type === 'provider' ? conn.provider : null,
      gateway_url: conn.type === 'gateway' ? conn.gateway_url : null,
      gateway_type: conn.type === 'gateway' ? conn.gateway_type : null,
      status: conn.status,
      credential_reference: conn.credential_reference,
      created_at: ts,
      updated_at: ts,
    };
    this.db.insert(connections).values(values).run();
    return { ...conn, created_at: new Date(ts), updated_at: new Date(ts) };
  }

  async updateConnectionStatus(connection_id: string, status: Connection['status']): Promise<void> {
    this.db
      .update(connections)
      .set({ status, updated_at: now() })
      .where(eq(connections.connection_id, connection_id))
      .run();
  }

  async deleteConnection(connection_id: string): Promise<void> {
    this.db.delete(connections).where(eq(connections.connection_id, connection_id)).run();
  }
}

// ============================================================================
// Route Repository
// ============================================================================

export class PrismaRouteRepository implements RouteRepository {
  constructor(private readonly db: DrizzleDB) {}

  async listRoutes(account_id: string): Promise<ModelRoute[]> {
    const rows = this.db
      .select()
      .from(model_routes)
      .innerJoin(connections, eq(model_routes.connection_id, connections.connection_id))
      .where(eq(connections.account_id, account_id))
      .all();
    return rows.map((r) => rowToRoute(r.model_routes));
  }

  async getRoute(route_id: string): Promise<ModelRoute | null> {
    const row = this.db
      .select()
      .from(model_routes)
      .where(eq(model_routes.route_id, route_id))
      .get();
    return row ? rowToRoute(row) : null;
  }

  async getRoutesForConnection(connection_id: string): Promise<ModelRoute[]> {
    const rows = this.db
      .select()
      .from(model_routes)
      .where(eq(model_routes.connection_id, connection_id))
      .all();
    return rows.map(rowToRoute);
  }

  async updateRouteAvailability(route_id: string, status: AvailabilityStatus): Promise<void> {
    this.db
      .update(model_routes)
      .set({ availability_status: status, updated_at: now() })
      .where(eq(model_routes.route_id, route_id))
      .run();
  }
}

// ============================================================================
// Policy Repository
// ============================================================================

export class PrismaPolicyRepository implements PolicyRepository {
  constructor(private readonly db: DrizzleDB) {}

  async getPolicy(policy_id: string): Promise<RoutingPolicy | null> {
    const row = this.db
      .select()
      .from(routing_policies)
      .where(eq(routing_policies.policy_id, policy_id))
      .get();
    return row ? rowToPolicy(row) : null;
  }

  async getDefaultPolicy(account_id: string): Promise<RoutingPolicy | null> {
    const row = this.db
      .select()
      .from(routing_policies)
      .where(eq(routing_policies.account_id, account_id))
      .limit(1)
      .get();
    return row ? rowToPolicy(row) : null;
  }

  async listPolicies(account_id: string): Promise<RoutingPolicy[]> {
    const rows = this.db
      .select()
      .from(routing_policies)
      .where(eq(routing_policies.account_id, account_id))
      .all();
    return rows.map(rowToPolicy);
  }

  async createPolicy(
    policy: Omit<RoutingPolicy, 'created_at' | 'updated_at'>
  ): Promise<RoutingPolicy> {
    const ts = now();
    this.db
      .insert(routing_policies)
      .values({
        policy_id: policy.policy_id,
        account_id: policy.account_id,
        name: policy.name,
        ordering_strategy: policy.ordering_strategy,
        admissibility_rules: JSON.stringify(policy.admissibility_rules),
        budget_constraints: JSON.stringify(policy.budget_constraints),
        retry_policy: policy.retry_policy ? JSON.stringify(policy.retry_policy) : null,
        manual_override_allowed: policy.manual_override_allowed,
        version: policy.version,
        created_at: ts,
        updated_at: ts,
      })
      .run();
    return { ...policy, created_at: new Date(ts), updated_at: new Date(ts) };
  }

  async updatePolicy(policy: RoutingPolicy): Promise<RoutingPolicy> {
    const ts = now();
    this.db
      .update(routing_policies)
      .set({
        name: policy.name,
        ordering_strategy: policy.ordering_strategy,
        admissibility_rules: JSON.stringify(policy.admissibility_rules),
        budget_constraints: JSON.stringify(policy.budget_constraints),
        retry_policy: policy.retry_policy ? JSON.stringify(policy.retry_policy) : null,
        manual_override_allowed: policy.manual_override_allowed,
        version: policy.version,
        updated_at: ts,
      })
      .where(eq(routing_policies.policy_id, policy.policy_id))
      .run();
    return { ...policy, updated_at: new Date(ts) };
  }
}

// ============================================================================
// Task Repository
// ============================================================================

export class PrismaTaskRepository implements TaskRepository {
  constructor(private readonly db: DrizzleDB) {}

  async getTask(task_id: string): Promise<Task | null> {
    const row = this.db.select().from(tasks).where(eq(tasks.task_id, task_id)).get();
    return row ? rowToTask(row) : null;
  }

  async listTasks(account_id: string): Promise<Task[]> {
    const rows = this.db.select().from(tasks).where(eq(tasks.account_id, account_id)).all();
    return rows.map(rowToTask);
  }

  async createTask(task: Omit<Task, 'created_at'>): Promise<Task> {
    const ts = now();
    this.db
      .insert(tasks)
      .values({
        task_id: task.task_id,
        account_id: task.account_id,
        description: task.description,
        requirements: JSON.stringify(task.requirements),
        status: task.status,
        created_at: ts,
      })
      .run();
    return { ...task, created_at: new Date(ts) };
  }

  async updateTaskStatus(
    task_id: string,
    status: Task['status'],
    expected_status?: Task['status']
  ): Promise<void> {
    if (expected_status !== undefined) {
      const result = this.db
        .update(tasks)
        .set({ status })
        .where(and(eq(tasks.task_id, task_id), eq(tasks.status, expected_status)))
        .run();
      if (result.changes === 0) {
        throw new Error('state_conflict');
      }
    } else {
      this.db.update(tasks).set({ status }).where(eq(tasks.task_id, task_id)).run();
    }
  }
}

// ============================================================================
// Decision Repository
// ============================================================================

export class PrismaDecisionRepository implements DecisionRepository {
  constructor(private readonly db: DrizzleDB) {}

  async getDecision(decision_id: string): Promise<RoutingDecision | null> {
    const row = this.db
      .select()
      .from(routing_decisions)
      .where(eq(routing_decisions.decision_id, decision_id))
      .get();
    return row ? rowToDecision(row) : null;
  }

  async createDecision(decision: Omit<RoutingDecision, 'decided_at'>): Promise<RoutingDecision> {
    const ts = now();
    this.db
      .insert(routing_decisions)
      .values({
        decision_id: decision.decision_id,
        task_id: decision.task_id,
        policy_id: decision.policy_id,
        policy_version: decision.policy_version,
        evaluated_routes: JSON.stringify(decision.evaluated_routes),
        admissible_routes: JSON.stringify(decision.admissible_routes),
        selected_route_id: decision.selected_route_id,
        route_snapshot: decision.route_snapshot ? JSON.stringify(decision.route_snapshot) : null,
        rejection_reasons: JSON.stringify(decision.rejection_reasons),
        estimated_cost: decision.estimated_cost,
        decided_at: ts,
        parent_decision_id: decision.parent_decision_id ?? null,
        fallback_reason: decision.fallback_reason ?? null,
        ordering_strategy_unsupported: decision.ordering_strategy_unsupported ?? null,
      })
      .run();
    return { ...decision, decided_at: new Date(ts) };
  }

  async listDecisionsForTask(task_id: string): Promise<RoutingDecision[]> {
    const rows = this.db
      .select()
      .from(routing_decisions)
      .where(eq(routing_decisions.task_id, task_id))
      .orderBy(asc(routing_decisions.decided_at))
      .all();
    return rows.map(rowToDecision);
  }
}

// ============================================================================
// Execution Repository
// ============================================================================

export class PrismaExecutionRepository implements ExecutionRepository {
  constructor(private readonly db: DrizzleDB) {}

  async getExecution(execution_id: string): Promise<Execution | null> {
    const row = this.db
      .select()
      .from(executions)
      .where(eq(executions.execution_id, execution_id))
      .get();
    return row ? rowToExecution(row) : null;
  }

  async getExecutionByIdempotencyKey(
    account_id: string,
    idempotency_key: string
  ): Promise<Execution | null> {
    const row = this.db
      .select()
      .from(executions)
      .where(
        and(eq(executions.account_id, account_id), eq(executions.idempotency_key, idempotency_key))
      )
      .get();
    return row ? rowToExecution(row) : null;
  }

  async createExecution(execution: Omit<Execution, 'created_at'>): Promise<Execution> {
    const ts = now();
    try {
      this.db
        .insert(executions)
        .values({ ...execution, created_at: ts })
        .run();
    } catch (error: unknown) {
      if (isUniqueConstraint(error)) throw idempotencyConflict();
      throw error;
    }
    return { ...execution, created_at: new Date(ts) };
  }

  async createExecutionWithRootAttempt(
    execution: Omit<Execution, 'created_at'>,
    attempt: Omit<ExecutionAttempt, 'created_at'>
  ): Promise<{ execution: Execution; attempt: ExecutionAttempt }> {
    const ts = now();
    try {
      this.db.$client.transaction(() => {
        this.db.$client
          .prepare(
            'INSERT INTO executions (execution_id, account_id, task_id, root_decision_id, idempotency_key, command_fingerprint, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
          )
          .run(
            execution.execution_id,
            execution.account_id,
            execution.task_id,
            execution.root_decision_id,
            execution.idempotency_key,
            execution.command_fingerprint ?? null,
            execution.status,
            ts
          );
        this.db.$client
          .prepare(
            'INSERT INTO execution_attempts (attempt_id, account_id, execution_id, task_id, decision_id, idempotency_key, status, started_at, completed_at, cancel_requested_at, cancelled_at, retry_count, retry_policy, parent_attempt_id, verification_outcome, failure_code, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
          )
          .run(
            attempt.attempt_id,
            attempt.account_id,
            attempt.execution_id,
            attempt.task_id,
            attempt.decision_id,
            attempt.idempotency_key,
            attempt.status,
            attempt.started_at?.toISOString() ?? null,
            attempt.completed_at?.toISOString() ?? null,
            attempt.cancel_requested_at?.toISOString() ?? null,
            attempt.cancelled_at?.toISOString() ?? null,
            attempt.retry_count,
            attempt.retry_policy ? JSON.stringify(attempt.retry_policy) : null,
            attempt.parent_attempt_id,
            attempt.verification_outcome,
            attempt.failure_code,
            ts
          );
      })();
    } catch (error: unknown) {
      if (isUniqueConstraint(error)) throw idempotencyConflict();
      throw error;
    }
    return {
      execution: { ...execution, created_at: new Date(ts) },
      attempt: { ...attempt, created_at: new Date(ts) },
    };
  }

  async updateExecutionStatus(
    execution_id: string,
    status: Execution['status'],
    expected_status?: Execution['status']
  ): Promise<void> {
    const result = expected_status
      ? this.db
          .update(executions)
          .set({ status })
          .where(
            and(eq(executions.execution_id, execution_id), eq(executions.status, expected_status))
          )
          .run()
      : this.db
          .update(executions)
          .set({ status })
          .where(eq(executions.execution_id, execution_id))
          .run();
    if (result.changes === 0) throw new Error('state_conflict');
  }

  async getAttempt(attempt_id: string): Promise<ExecutionAttempt | null> {
    const row = this.db
      .select()
      .from(execution_attempts)
      .where(eq(execution_attempts.attempt_id, attempt_id))
      .get();
    return row ? rowToAttempt(row) : null;
  }

  async getAttemptByIdempotencyKey(
    account_id: string,
    idempotency_key: string
  ): Promise<ExecutionAttempt | null> {
    const row = this.db
      .select()
      .from(execution_attempts)
      .where(
        and(
          eq(execution_attempts.account_id, account_id),
          eq(execution_attempts.idempotency_key, idempotency_key),
          sql`${execution_attempts.parent_attempt_id} IS NULL`
        )
      )
      .get();
    return row ? rowToAttempt(row) : null;
  }

  async createAttempt(attempt: Omit<ExecutionAttempt, 'created_at'>): Promise<ExecutionAttempt> {
    const ts = now();
    try {
      this.db
        .insert(execution_attempts)
        .values({
          attempt_id: attempt.attempt_id,
          account_id: attempt.account_id,
          execution_id: attempt.execution_id,
          task_id: attempt.task_id,
          decision_id: attempt.decision_id,
          idempotency_key: attempt.idempotency_key,
          status: attempt.status,
          started_at: attempt.started_at?.toISOString() ?? null,
          completed_at: attempt.completed_at?.toISOString() ?? null,
          cancel_requested_at: attempt.cancel_requested_at?.toISOString() ?? null,
          cancelled_at: attempt.cancelled_at?.toISOString() ?? null,
          retry_count: attempt.retry_count,
          retry_policy: attempt.retry_policy ? JSON.stringify(attempt.retry_policy) : null,
          parent_attempt_id: attempt.parent_attempt_id,
          verification_outcome: attempt.verification_outcome,
          failure_code: attempt.failure_code,
          created_at: ts,
        })
        .run();
      return { ...attempt, created_at: new Date(ts) };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : '';
      if (msg.includes('UNIQUE')) throw idempotencyConflict();
      throw error;
    }
  }

  async listAttemptsForTask(task_id: string): Promise<ExecutionAttempt[]> {
    const rows = this.db
      .select()
      .from(execution_attempts)
      .where(eq(execution_attempts.task_id, task_id))
      .orderBy(asc(execution_attempts.created_at))
      .all();
    return rows.map(rowToAttempt);
  }

  async updateAttemptStatus(
    attempt_id: string,
    status: ExecutionAttempt['status'],
    updates: Partial<ExecutionAttempt>,
    expected_status?: ExecutionAttempt['status']
  ): Promise<void> {
    const setValues: Record<string, string | number | null> = { status };
    if (updates.started_at !== undefined)
      setValues.started_at = updates.started_at?.toISOString() ?? null;
    if (updates.completed_at !== undefined)
      setValues.completed_at = updates.completed_at?.toISOString() ?? null;
    if (updates.cancel_requested_at !== undefined)
      setValues.cancel_requested_at = updates.cancel_requested_at?.toISOString() ?? null;
    if (updates.cancelled_at !== undefined)
      setValues.cancelled_at = updates.cancelled_at?.toISOString() ?? null;
    if (updates.verification_outcome !== undefined)
      setValues.verification_outcome = updates.verification_outcome;
    if (updates.failure_code !== undefined) setValues.failure_code = updates.failure_code;
    if (updates.retry_policy !== undefined)
      setValues.retry_policy = updates.retry_policy ? JSON.stringify(updates.retry_policy) : null;

    let result;
    if (expected_status !== undefined) {
      result = this.db
        .update(execution_attempts)
        .set(setValues)
        .where(
          and(
            eq(execution_attempts.attempt_id, attempt_id),
            eq(execution_attempts.status, expected_status)
          )
        )
        .run();
    } else {
      result = this.db
        .update(execution_attempts)
        .set(setValues)
        .where(eq(execution_attempts.attempt_id, attempt_id))
        .run();
    }
    if (result.changes === 0) {
      throw new Error('state_conflict');
    }
  }
}

function isUniqueConstraint(error: unknown): boolean {
  return error instanceof Error && error.message.toUpperCase().includes('UNIQUE');
}

function idempotencyConflict(): Error & { code: string } {
  const error = new Error('idempotency_conflict') as Error & { code: string };
  error.code = 'idempotency_conflict';
  return error;
}

// ============================================================================
// Usage Repository
// ============================================================================

export class PrismaUsageRepository implements UsageRepository {
  constructor(private readonly db: DrizzleDB) {}

  async getUsage(usage_id: string): Promise<UsageRecord | null> {
    const row = this.db
      .select()
      .from(usage_records)
      .where(eq(usage_records.usage_id, usage_id))
      .get();
    return row ? rowToUsage(row) : null;
  }

  async getUsageForAttempt(attempt_id: string): Promise<UsageRecord | null> {
    const row = this.db
      .select()
      .from(usage_records)
      .where(eq(usage_records.attempt_id, attempt_id))
      .get();
    return row ? rowToUsage(row) : null;
  }

  async createUsage(usage: Omit<UsageRecord, 'reconciled_at'>): Promise<UsageRecord> {
    const ts = now();
    try {
      this.db
        .insert(usage_records)
        .values({
          usage_id: usage.usage_id,
          account_id: usage.account_id,
          attempt_id: usage.attempt_id,
          provider_usage_data: JSON.stringify(usage.provider_usage_data),
          actual_cost: usage.actual_cost,
          cost_breakdown: JSON.stringify(usage.cost_breakdown),
          input_tokens: usage.tokens_used?.input ?? null,
          output_tokens: usage.tokens_used?.output ?? null,
          reconciled_at: ts,
          cost_variance: usage.cost_variance,
        })
        .run();
      return { ...usage, reconciled_at: new Date(ts) };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : '';
      if (msg.includes('UNIQUE') || msg.includes('usage_records_attempt_id')) {
        const conflictError = new Error('usage_already_reconciled') as Error & { code: string };
        conflictError.code = 'usage_already_reconciled';
        throw conflictError;
      }
      throw error;
    }
  }

  async listUsageForAccount(account_id: string): Promise<UsageRecord[]> {
    const rows = this.db
      .select()
      .from(usage_records)
      .where(eq(usage_records.account_id, account_id))
      .orderBy(asc(usage_records.reconciled_at))
      .all();
    return rows.map(rowToUsage);
  }

  async getDailySpending(account_id: string): Promise<number> {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const rows = this.db
      .select({
        total: sql<number>`coalesce(sum(${usage_records.actual_cost}), 0)`,
      })
      .from(usage_records)
      .where(
        and(
          eq(usage_records.account_id, account_id),
          sql`${usage_records.reconciled_at} >= ${start.toISOString()}`
        )
      )
      .all();
    return rows[0]?.total ?? 0;
  }

  async getMonthlySpending(account_id: string): Promise<number> {
    const start = new Date();
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    const rows = this.db
      .select({
        total: sql<number>`coalesce(sum(${usage_records.actual_cost}), 0)`,
      })
      .from(usage_records)
      .where(
        and(
          eq(usage_records.account_id, account_id),
          sql`${usage_records.reconciled_at} >= ${start.toISOString()}`
        )
      )
      .all();
    return rows[0]?.total ?? 0;
  }
}

// ============================================================================
// Audit Repository
// ============================================================================

export class PrismaAuditRepository implements AuditRepository {
  constructor(private readonly db: DrizzleDB) {}

  async recordEvent(event: Omit<AuditEvent, 'timestamp'>): Promise<AuditEvent> {
    const ts = now();
    this.db
      .insert(audit_events)
      .values({
        event_id: event.event_id,
        account_id: event.account_id,
        event_type: event.event_type,
        actor: event.actor,
        resource_type: event.resource_type,
        resource_id: event.resource_id,
        metadata: JSON.stringify(event.metadata),
        timestamp: ts,
      })
      .run();
    return { ...event, timestamp: new Date(ts) };
  }

  async listEvents(
    account_id: string,
    filters?: {
      event_type?: string;
      start_time?: Date;
      end_time?: Date;
      limit?: number;
      offset?: number;
    }
  ): Promise<{ events: AuditEvent[]; total_count: number }> {
    const conditions = [eq(audit_events.account_id, account_id)];
    if (filters?.event_type) conditions.push(eq(audit_events.event_type, filters.event_type));
    if (filters?.start_time)
      conditions.push(sql`${audit_events.timestamp} >= ${filters.start_time.toISOString()}`);
    if (filters?.end_time)
      conditions.push(sql`${audit_events.timestamp} <= ${filters.end_time.toISOString()}`);

    const where = conditions.length === 1 ? conditions[0] : and(...conditions);

    const countRows = this.db
      .select({
        count: sql<number>`count(*)`,
      })
      .from(audit_events)
      .where(where)
      .all();
    const total_count = countRows[0]?.count ?? 0;

    const offset = Math.max(0, filters?.offset ?? 0);
    const limit = Math.min(100, Math.max(1, filters?.limit ?? 50));

    const rows = this.db
      .select()
      .from(audit_events)
      .where(where)
      .orderBy(desc(audit_events.timestamp))
      .limit(limit)
      .offset(offset)
      .all();

    return {
      events: rows.map(rowToAudit),
      total_count,
    };
  }
}

// ============================================================================
// Aggregate repository factory
// ============================================================================

export interface DatabaseRepositories {
  principals: PrismaPrincipalRepository;
  accounts: PrismaAccountRepository;
  memberships: PrismaMembershipRepository;
  connections: PrismaConnectionRepository;
  routes: PrismaRouteRepository;
  policies: PrismaPolicyRepository;
  tasks: PrismaTaskRepository;
  decisions: PrismaDecisionRepository;
  executions: PrismaExecutionRepository;
  usage: PrismaUsageRepository;
  audit: PrismaAuditRepository;
}

export function createDatabaseRepositories(db: DrizzleDB): DatabaseRepositories {
  return {
    principals: new PrismaPrincipalRepository(db),
    accounts: new PrismaAccountRepository(db),
    memberships: new PrismaMembershipRepository(db),
    connections: new PrismaConnectionRepository(db),
    routes: new PrismaRouteRepository(db),
    policies: new PrismaPolicyRepository(db),
    tasks: new PrismaTaskRepository(db),
    decisions: new PrismaDecisionRepository(db),
    executions: new PrismaExecutionRepository(db),
    usage: new PrismaUsageRepository(db),
    audit: new PrismaAuditRepository(db),
  };
}
