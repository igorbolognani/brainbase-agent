import type {
  Account,
  AccountMembership,
  AccountRepository,
  AuthorizedExecutionContext,
  AuditEvent,
  AuditRepository,
  Connection,
  ConnectionRepository,
  DecisionRepository,
  Execution,
  ExecutionAttempt,
  ExecutionRepository,
  MembershipRepository,
  ModelRoute,
  Principal,
  PrincipalRepository,
  PolicyRepository,
  RouteRepository,
  RoutingDecision,
  RoutingPolicy,
  Task,
  TaskRepository,
  UsageRecord,
  UsageRepository,
  OrderingStrategy,
  VerificationOutcome,
} from '@gptrouter/contracts';
import {
  AdapterExecutionCoordinatorBridge,
  AdapterExecutionVerifier,
  BudgetEnforcer,
  DefaultProviderAdapterRegistry,
  DeterministicVerifier,
  ExecutionCoordinator,
  FakeProviderAdapter,
  generateId,
  type CredentialResolver,
  ProviderAdapterRegistry,
  RoutingEngine,
  SyntheticExecutor,
  type FallbackPlanner,
  type ExecutionCoordinatorRepositories,
  type ExecutionExecutor,
  type ExecutionProjection,
  type ExecutionRequest,
  type ExecutionVerifier,
} from '@gptrouter/domain';
import {
  AccountAuthorizationService,
  AuthorizationError,
  sanitizeForPublicOutput,
} from '@gptrouter/security';

export const SYNTHETIC_ACCOUNT_ID = 'account-synthetic-v0';
export const SYNTHETIC_DATA_MODE = 'synthetic_repository';
export const PRODUCTION_DATA_MODE = 'postgresql';
export type RuntimeDataMode = typeof SYNTHETIC_DATA_MODE | typeof PRODUCTION_DATA_MODE;
export const SYNTHETIC_ISSUER = 'synthetic-issuer';

export interface ListRoutesQuery {
  capability_filter?: string[];
  provider_filter?: string;
}

export interface PlanTaskRequest {
  description: string;
  required_capabilities: string[];
  ordering_strategy: OrderingStrategy;
}

export interface PublicRouteProjection {
  route_id: string;
  route_type: ModelRoute['route_type'];
  connection_id: string;
  source_id: string;
  source_provider?: string;
  source_gateway?: string;
  capabilities: string[];
  pricing: {
    input_cost_per_1k_tokens: number;
    output_cost_per_1k_tokens: number;
    currency: string;
    units: string;
    source: string;
    pricing_status: import('@gptrouter/contracts').PricingStatus;
    effective_at: string;
    refreshed_at: string;
    version: string;
  };
  availability_status: ModelRoute['availability_status'];
  provenance: RuntimeDataMode;
}

export interface PlannedTaskProjection {
  task_id: string;
  decision_id: string;
  status: 'planning';
  description: string;
  required_capabilities: string[];
  ordering_strategy: OrderingStrategy;
  selected_route: PublicRouteProjection | null;
  estimated_cost: number | null;
  actual_cost: number;
  data_mode: RuntimeDataMode;
  decided_at: string;
  note: string;
}

export interface TaskProjection {
  task: {
    task_id: string;
    account_id: string;
    description: string;
    requirements: Task['requirements'];
    status: Task['status'];
    created_at: string;
  };
  routing_decisions: PublicRoutingDecision[];
  decision_tree: {
    decision_id: string;
    parent_decision_id: string | null;
    fallback_reason: string | null;
    selected_route_id: string | null;
    estimated_cost: number | null;
    decided_at: string;
  }[];
  latest_decision: PublicRoutingDecision | null;
  attempts: PublicAttemptProjection[];
  attempt_tree: {
    attempt_id: string;
    execution_id: string;
    parent_attempt_id: string | null;
    decision_id: string;
    status: ExecutionAttempt['status'];
    retry_count: number;
    verification_outcome: VerificationOutcome | null;
    failure_code: string | null;
    started_at: string | null;
    completed_at: string | null;
    cancel_requested_at: string | null;
    cancelled_at: string | null;
  }[];
  latest_attempt: PublicAttemptProjection | null;
  execution_id: string | null;
  retry_count: number;
  fallback_count: number;
  audit_degraded: boolean;
  actual_cost: number;
  known_actual_cost: number;
  unknown_cost_attempt_count: number;
  cost_complete: boolean;
  estimated_cost: number | null;
  cost_variance: number | null;
  execution_status: ExecutionAttempt['status'] | 'not_started';
  verification_outcome: VerificationOutcome | null;
  cancellation_status: 'not_requested' | 'requested' | 'cancelled';
  data_mode: RuntimeDataMode;
}

export interface PublicRoutingDecision {
  decision_id: string;
  task_id: string;
  policy_id: string;
  policy_version: number;
  evaluated_routes: string[];
  admissible_routes: string[];
  selected_route_id: string | null;
  route_snapshot: RoutingDecision['route_snapshot'];
  estimated_cost: number | null;
  rejection_reasons: RoutingDecision['rejection_reasons'];
  decided_at: string;
  parent_decision_id: string | null;
  fallback_reason: string | null;
}

export interface PublicAttemptProjection {
  attempt_id: string;
  execution_id: string;
  task_id: string;
  decision_id: string;
  status: ExecutionAttempt['status'];
  retry_count: number;
  verification_outcome: VerificationOutcome | null;
  failure_code: string | null;
  started_at: string | null;
  completed_at: string | null;
  cancel_requested_at: string | null;
  cancelled_at: string | null;
  parent_attempt_id: string | null;
}

export interface UsageProjection {
  time_range: 'today' | 'week' | 'month';
  planning_requests: number;
  execution_requests: number;
  execution_roots: number;
  total_attempts: number;
  successful_executions: number;
  failed_attempts: number;
  cancelled_attempts: number;
  actual_cost: number;
  known_actual_cost: number;
  unknown_cost_attempt_count: number;
  cost_complete: boolean;
  estimated_planned_cost: number;
  actual_usage_records: number;
  cost_variance: number;
  audit_degraded: boolean;
  data_mode: RuntimeDataMode;
  note: string;
}

export interface DashboardRuntimeSummary {
  data_source: RuntimeDataMode;
  route_count: number;
  task_count: number;
  decision_count: number;
  execution_count: number;
  successful_execution_count: number;
  failed_attempt_count: number;
  cancelled_attempt_count: number;
  actual_spend: number;
  estimated_planned_cost: number;
  retry_count: number;
  fallback_count: number;
  audit_degraded: boolean;
  audit_failure_count: number;
  synthetic_execution_enabled: boolean;
  provider_execution_enabled: boolean;
  paid_calls_enabled: boolean;
}

export interface VerifiedExecutionIdentity {
  issuer: string;
  subject: string;
  account_id: string;
}

export interface PublicAuditEvent {
  event_id: string;
  event_type: string;
  actor: string;
  resource_type: string | null;
  resource_id: string | null;
  metadata: Record<string, unknown>;
  timestamp: string;
}

export interface AuditStatus {
  audit_degraded: boolean;
  audit_failure_count: number;
}

export interface SyntheticApplicationOptions {
  executor?: ExecutionExecutor;
  verifier?: ExecutionVerifier;
  requireAuthorizedExecution?: boolean;
  audit_failure_mode?: boolean;
  clock?: () => Date;
  provider_execution_enabled?: boolean;
  adapterRegistry?: ProviderAdapterRegistry;
  credentialResolver?: CredentialResolver;
}

export interface GPTRouterApplication {
  readonly account_id: string;
  listRoutes(
    query?: ListRoutesQuery,
    context?: AuthorizedExecutionContext
  ): Promise<PublicRouteProjection[]>;
  planTask(
    request: PlanTaskRequest,
    context?: AuthorizedExecutionContext
  ): Promise<PlannedTaskProjection>;
  getTask(task_id: string, context?: AuthorizedExecutionContext): Promise<TaskProjection | null>;
  getUsage(
    time_range?: 'today' | 'week' | 'month',
    context?: AuthorizedExecutionContext
  ): Promise<UsageProjection>;
  getDashboardSummary(context?: AuthorizedExecutionContext): Promise<DashboardRuntimeSummary>;
  runTask(
    request: ExecutionRequest,
    context?: AuthorizedExecutionContext
  ): Promise<ExecutionProjection>;
  cancelExecution(
    attempt_id: string,
    context?: AuthorizedExecutionContext
  ): Promise<ExecutionProjection>;
  authorizeVerifiedIdentity(
    identity: VerifiedExecutionIdentity,
    minimumRole?: AccountMembership['role']
  ): Promise<AuthorizedExecutionContext>;
  getAuditEvents(
    context?: AuthorizedExecutionContext,
    limit?: number,
    offset?: number,
    event_type?: string
  ): Promise<PublicAuditEvent[]>;
  getAuditStatus(): AuditStatus;
  getSyntheticAuthorizedContext(): AuthorizedExecutionContext;
}

interface SyntheticStore {
  principals: Map<string, Principal>;
  accounts: Map<string, Account>;
  memberships: Map<string, AccountMembership>;
  connections: Map<string, Connection>;
  routes: Map<string, ModelRoute>;
  policies: Map<string, RoutingPolicy>;
  tasks: Map<string, Task>;
  decisions: Map<string, RoutingDecision>;
  executions: Map<string, Execution>;
  attempts: Map<string, ExecutionAttempt>;
  usage: Map<string, UsageRecord>;
  audit: Map<string, AuditEvent>;
  auditOrder: string[];
  auditFailureCount: number;
}

interface SyntheticRepositories {
  store: SyntheticStore;
  principals: PrincipalRepository;
  accounts: AccountRepository;
  memberships: MembershipRepository;
  connections: ConnectionRepository;
  routes: RouteRepository;
  policies: PolicyRepository;
  tasks: TaskRepository;
  decisions: DecisionRepository;
  executions: ExecutionRepository;
  usage: UsageRepository;
  audit: AuditRepository;
}

interface SyntheticRepositoryOptions {
  audit_failure_mode?: boolean;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function safeAuditMetadata(value: Record<string, unknown>): Record<string, unknown> {
  const sanitized = sanitizeForPublicOutput(value);
  if (sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized)) {
    return sanitized as Record<string, unknown>;
  }
  return {};
}

function createSyntheticRepositories(
  now: Date,
  options: SyntheticRepositoryOptions = {}
): SyntheticRepositories {
  const store: SyntheticStore = {
    principals: new Map(),
    accounts: new Map(),
    memberships: new Map(),
    connections: new Map(),
    routes: new Map(),
    policies: new Map(),
    tasks: new Map(),
    decisions: new Map(),
    executions: new Map(),
    attempts: new Map(),
    usage: new Map(),
    audit: new Map(),
    auditOrder: [],
    auditFailureCount: 0,
  };

  const principals: PrincipalRepository = {
    async getPrincipal(principal_id) {
      const principal = store.principals.get(principal_id);
      return principal ? clone(principal) : null;
    },
    async getPrincipalBySubject(issuer, subject) {
      const principal = [...store.principals.values()].find(
        (item) => item.issuer === issuer && item.subject === subject
      );
      return principal ? clone(principal) : null;
    },
  };

  const accounts: AccountRepository = {
    async getAccount(account_id) {
      const account = store.accounts.get(account_id);
      return account ? clone(account) : null;
    },
    async createAccount(account) {
      const created = { ...account, created_at: new Date() };
      store.accounts.set(created.account_id, clone(created));
      return clone(created);
    },
  };

  const memberships: MembershipRepository = {
    async getMembership(account_id, principal_id) {
      const membership = store.memberships.get(`${account_id}\u0000${principal_id}`);
      return membership ? clone(membership) : null;
    },
    async listMembershipsForPrincipal(principal_id) {
      return [...store.memberships.values()]
        .filter((membership) => membership.principal_id === principal_id)
        .map(clone);
    },
  };

  const connections: ConnectionRepository = {
    async listConnections(account_id) {
      return [...store.connections.values()]
        .filter((connection) => connection.account_id === account_id)
        .map(clone);
    },
    async getConnection(connection_id) {
      const connection = store.connections.get(connection_id);
      return connection ? clone(connection) : null;
    },
    async createConnection(connection) {
      const created = {
        ...connection,
        created_at: new Date(),
        updated_at: new Date(),
      } as Connection;
      store.connections.set(created.connection_id, clone(created));
      return clone(created);
    },
    async updateConnectionStatus(connection_id, status) {
      const connection = store.connections.get(connection_id);
      if (!connection) return;
      store.connections.set(connection_id, { ...connection, status, updated_at: new Date() });
    },
    async deleteConnection(connection_id) {
      store.connections.delete(connection_id);
    },
  };

  const routes: RouteRepository = {
    async listRoutes(account_id) {
      const connectionIds = new Set(
        [...store.connections.values()]
          .filter((connection) => connection.account_id === account_id)
          .map((connection) => connection.connection_id)
      );
      return [...store.routes.values()]
        .filter((route) => connectionIds.has(route.connection_id))
        .map(clone);
    },
    async getRoute(route_id) {
      const route = store.routes.get(route_id);
      return route ? clone(route) : null;
    },
    async getRoutesForConnection(connection_id) {
      return [...store.routes.values()]
        .filter((route) => route.connection_id === connection_id)
        .map(clone);
    },
    async updateRouteAvailability(route_id, status) {
      const route = store.routes.get(route_id);
      if (!route) return;
      store.routes.set(route_id, { ...route, availability_status: status, updated_at: new Date() });
    },
  };

  const policies: PolicyRepository = {
    async getPolicy(policy_id) {
      const policy = store.policies.get(policy_id);
      return policy ? clone(policy) : null;
    },
    async getDefaultPolicy(account_id) {
      const policy = [...store.policies.values()].find((item) => item.account_id === account_id);
      return policy ? clone(policy) : null;
    },
    async listPolicies(account_id) {
      return [...store.policies.values()]
        .filter((policy) => policy.account_id === account_id)
        .map(clone);
    },
    async createPolicy(policy) {
      const created: RoutingPolicy = {
        ...policy,
        created_at: new Date(),
        updated_at: new Date(),
      };
      store.policies.set(created.policy_id, clone(created));
      return clone(created);
    },
    async updatePolicy(policy) {
      const updated = { ...policy, updated_at: new Date() };
      store.policies.set(updated.policy_id, clone(updated));
      return clone(updated);
    },
  };

  const tasks: TaskRepository = {
    async getTask(task_id) {
      const task = store.tasks.get(task_id);
      return task ? clone(task) : null;
    },
    async listTasks(account_id) {
      return [...store.tasks.values()].filter((task) => task.account_id === account_id).map(clone);
    },
    async createTask(task) {
      const created: Task = { ...task, created_at: new Date() };
      store.tasks.set(created.task_id, clone(created));
      return clone(created);
    },
    async updateTaskStatus(task_id, status, expected_status) {
      const task = store.tasks.get(task_id);
      if (!task) return;
      if (expected_status !== undefined && task.status !== expected_status) {
        throw new Error('state_conflict');
      }
      if (task.status !== status) {
        const allowed: Record<Task['status'], Task['status'][]> = {
          planning: ['approved'],
          approved: ['executing'],
          executing: ['completed', 'failed', 'cancelled'],
          completed: [],
          failed: [],
          cancelled: [],
        };
        if (!allowed[task.status].includes(status)) throw new Error('illegal_task_transition');
      }
      store.tasks.set(task_id, { ...task, status });
    },
  };

  const decisions: DecisionRepository = {
    async getDecision(decision_id) {
      const decision = store.decisions.get(decision_id);
      return decision ? clone(decision) : null;
    },
    async createDecision(decision) {
      const created: RoutingDecision = { ...decision, decided_at: new Date() };
      store.decisions.set(created.decision_id, clone(created));
      return clone(created);
    },
    async listDecisionsForTask(task_id) {
      return [...store.decisions.values()]
        .filter((decision) => decision.task_id === task_id)
        .sort((a, b) => a.decided_at.getTime() - b.decided_at.getTime())
        .map(clone);
    },
  };

  const executions: ExecutionRepository = {
    async getExecution(execution_id) {
      const execution = store.executions.get(execution_id);
      return execution ? clone(execution) : null;
    },
    async getExecutionByIdempotencyKey(account_id, idempotency_key) {
      const execution = [...store.executions.values()].find(
        (item) => item.account_id === account_id && item.idempotency_key === idempotency_key
      );
      return execution ? clone(execution) : null;
    },
    async createExecution(execution) {
      const duplicate = [...store.executions.values()].find(
        (item) =>
          item.account_id === execution.account_id &&
          item.idempotency_key === execution.idempotency_key
      );
      if (duplicate) {
        const error = new Error('idempotency_conflict') as Error & { code: string };
        error.code = 'idempotency_conflict';
        throw error;
      }
      const created: Execution = { ...execution, created_at: new Date() };
      store.executions.set(created.execution_id, clone(created));
      return clone(created);
    },
    async createExecutionWithRootAttempt(execution, attempt) {
      const duplicate = [...store.executions.values()].find(
        (item) =>
          item.account_id === execution.account_id &&
          item.idempotency_key === execution.idempotency_key
      );
      if (duplicate) {
        const error = new Error('idempotency_conflict') as Error & { code: string };
        error.code = 'idempotency_conflict';
        throw error;
      }
      const createdExecution: Execution = { ...execution, created_at: new Date() };
      const createdAttempt: ExecutionAttempt = { ...attempt, created_at: new Date() };
      store.executions.set(createdExecution.execution_id, clone(createdExecution));
      store.attempts.set(createdAttempt.attempt_id, clone(createdAttempt));
      return { execution: clone(createdExecution), attempt: clone(createdAttempt) };
    },
    async updateExecutionStatus(execution_id, status, expected_status) {
      const execution = store.executions.get(execution_id);
      if (!execution) return;
      if (expected_status !== undefined && execution.status !== expected_status) {
        throw new Error('state_conflict');
      }
      store.executions.set(execution_id, { ...execution, status });
    },
    async getAttempt(attempt_id) {
      const attempt = store.attempts.get(attempt_id);
      return attempt ? clone(attempt) : null;
    },
    async getAttemptByIdempotencyKey(account_id, idempotency_key) {
      const attempt = [...store.attempts.values()].find(
        (item) =>
          item.account_id === account_id &&
          item.idempotency_key === idempotency_key &&
          item.parent_attempt_id === null
      );
      return attempt ? clone(attempt) : null;
    },
    async createAttempt(attempt) {
      const duplicate =
        attempt.parent_attempt_id === null
          ? [...store.attempts.values()].find(
              (item) =>
                item.account_id === attempt.account_id &&
                item.idempotency_key === attempt.idempotency_key &&
                item.parent_attempt_id === null
            )
          : undefined;
      if (duplicate) {
        const error = new Error('idempotency_conflict') as Error & { code: string };
        error.code = 'idempotency_conflict';
        throw error;
      }
      const created: ExecutionAttempt = { ...attempt, created_at: new Date() };
      store.attempts.set(created.attempt_id, clone(created));
      return clone(created);
    },
    async listAttemptsForTask(task_id) {
      return [...store.attempts.values()]
        .filter((attempt) => attempt.task_id === task_id)
        .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())
        .map(clone);
    },
    async updateAttemptStatus(attempt_id, status, updates, expected_status) {
      const attempt = store.attempts.get(attempt_id);
      if (!attempt) return;
      if (expected_status !== undefined && attempt.status !== expected_status) {
        throw new Error('state_conflict');
      }
      if (attempt.status !== status) {
        const allowed: Record<ExecutionAttempt['status'], ExecutionAttempt['status'][]> = {
          pending: ['running', 'cancelled'],
          running: ['completed', 'failed', 'cancel_requested', 'cancelled'],
          completed: [],
          failed: [],
          cancel_requested: ['cancelled', 'completed'],
          cancelled: [],
        };
        if (!allowed[attempt.status].includes(status)) {
          throw new Error('illegal_attempt_transition');
        }
      }
      store.attempts.set(attempt_id, clone({ ...attempt, ...updates, status }));
    },
  };

  const usage: UsageRepository = {
    async getUsage(usage_id) {
      const record = store.usage.get(usage_id);
      return record ? clone(record) : null;
    },
    async getUsageForAttempt(attempt_id) {
      const record = [...store.usage.values()].find((item) => item.attempt_id === attempt_id);
      return record ? clone(record) : null;
    },
    async listUsageForAccount(account_id) {
      return [...store.usage.values()]
        .filter((record) => record.account_id === account_id)
        .sort((a, b) => a.reconciled_at.getTime() - b.reconciled_at.getTime())
        .map(clone);
    },
    async createUsage(record) {
      const duplicate = [...store.usage.values()].find(
        (item) => item.attempt_id === record.attempt_id
      );
      if (duplicate) {
        const error = new Error('usage_already_reconciled') as Error & { code: string };
        error.code = 'usage_already_reconciled';
        throw error;
      }
      const created: UsageRecord = { ...record, reconciled_at: new Date() };
      store.usage.set(created.usage_id, clone(created));
      return clone(created);
    },
    async getDailySpending(account_id) {
      return [...store.usage.values()]
        .filter((record) => record.account_id === account_id)
        .filter((record) => record.reconciled_at >= startOfDay(new Date()))
        .reduce((sum, record) => sum + (record.actual_cost ?? 0), 0);
    },
    async getMonthlySpending(account_id) {
      return [...store.usage.values()]
        .filter((record) => record.account_id === account_id)
        .filter((record) => record.reconciled_at >= startOfMonth(new Date()))
        .reduce((sum, record) => sum + (record.actual_cost ?? 0), 0);
    },
  };

  const audit: AuditRepository = {
    async recordEvent(event) {
      if (options.audit_failure_mode) throw new Error('audit_unavailable');
      const created: AuditEvent = {
        ...event,
        metadata: safeAuditMetadata(event.metadata),
        timestamp: new Date(),
      };
      store.audit.set(created.event_id, clone(created));
      store.auditOrder.push(created.event_id);
      return clone(created);
    },
    async listEvents(account_id, filters = {}) {
      const matching = [...store.audit.values()]
        .filter((event) => event.account_id === account_id)
        .filter((event) => !filters.event_type || event.event_type === filters.event_type)
        .filter((event) => !filters.start_time || event.timestamp >= filters.start_time)
        .filter((event) => !filters.end_time || event.timestamp <= filters.end_time)
        .sort((a, b) => {
          const timestampOrder = b.timestamp.getTime() - a.timestamp.getTime();
          if (timestampOrder !== 0) return timestampOrder;
          return store.auditOrder.indexOf(b.event_id) - store.auditOrder.indexOf(a.event_id);
        });
      const offset = Math.max(0, filters.offset ?? 0);
      const limit = Math.min(100, Math.max(1, filters.limit ?? 50));
      return {
        events: matching.slice(offset, offset + limit).map(clone),
        total_count: matching.length,
      };
    },
  };

  const connectionA: Connection = {
    type: 'provider',
    connection_id: 'connection-synthetic-free',
    account_id: SYNTHETIC_ACCOUNT_ID,
    provider: 'synthetic-provider-alpha',
    status: 'active',
    credential_reference: 'opaque-synthetic-reference-alpha',
    created_at: now,
    updated_at: now,
  };
  const connectionB: Connection = {
    type: 'provider',
    connection_id: 'connection-synthetic-multimodal',
    account_id: SYNTHETIC_ACCOUNT_ID,
    provider: 'synthetic-provider-beta',
    status: 'active',
    credential_reference: 'opaque-synthetic-reference-beta',
    created_at: now,
    updated_at: now,
  };
  store.connections.set(connectionA.connection_id, clone(connectionA));
  store.connections.set(connectionB.connection_id, clone(connectionB));

  const freeRoute: ModelRoute = {
    route_id: 'route-synthetic-text-free',
    route_type: 'provider',
    connection_id: connectionA.connection_id,
    source_id: 'synthetic-text-free',
    source_provider: connectionA.provider,
    capabilities: ['text', 'function-calling'],
    pricing: {
      input_cost_per_1k_tokens: 0,
      output_cost_per_1k_tokens: 0,
      currency: 'USD',
      units: 'per_1k_tokens',
      source: 'synthetic-fixture',
      pricing_status: 'known_free',
      effective_at: now,
      refreshed_at: now,
      version: 'synthetic-v1',
    },
    availability_status: 'available',
    created_at: now,
    updated_at: now,
  };
  const multimodalRoute: ModelRoute = {
    route_id: 'route-synthetic-multimodal-cheap',
    route_type: 'provider',
    connection_id: connectionB.connection_id,
    source_id: 'synthetic-multimodal-cheap',
    source_provider: connectionB.provider,
    capabilities: ['text', 'vision', 'audio', 'function-calling'],
    pricing: {
      input_cost_per_1k_tokens: 0.001,
      output_cost_per_1k_tokens: 0.002,
      currency: 'USD',
      units: 'per_1k_tokens',
      source: 'synthetic-fixture',
      pricing_status: 'known_paid',
      effective_at: now,
      refreshed_at: now,
      version: 'synthetic-v1',
    },
    availability_status: 'available',
    created_at: now,
    updated_at: now,
  };
  store.routes.set(freeRoute.route_id, clone(freeRoute));
  store.routes.set(multimodalRoute.route_id, clone(multimodalRoute));

  const defaultPolicy: RoutingPolicy = {
    policy_id: 'policy-synthetic-default',
    account_id: SYNTHETIC_ACCOUNT_ID,
    name: 'Synthetic V0.1 lowest-cost adequate capability',
    ordering_strategy: 'cost',
    admissibility_rules: { allowed_route_types: ['provider'] },
    budget_constraints: {
      max_cost_per_task: 0.05,
      daily_cap: 1,
      monthly_cap: 10,
    },
    retry_policy: {
      max_retries: 1,
      backoff_multiplier: 2,
      initial_delay_ms: 0,
      retryable_failure_codes: ['retryable_failure', 'synthetic_retryable_failure'],
      fallback_enabled: true,
      max_fallbacks: 1,
      max_total_estimated_cost: 0.05,
    },
    manual_override_allowed: true,
    version: 1,
    created_at: now,
    updated_at: now,
  };
  store.policies.set(defaultPolicy.policy_id, clone(defaultPolicy));

  const account: Account = {
    account_id: SYNTHETIC_ACCOUNT_ID,
    name: 'Synthetic V0.1 account',
    created_at: now,
    updated_at: now,
  };
  const principal: Principal = {
    principal_id: 'principal-synthetic-v0',
    issuer: SYNTHETIC_ISSUER,
    subject: 'principal-synthetic-v0',
    created_at: now,
    updated_at: now,
  };
  const membership: AccountMembership = {
    membership_id: 'membership-synthetic-v0',
    account_id: account.account_id,
    principal_id: principal.principal_id,
    role: 'owner',
    status: 'active',
    created_at: now,
    updated_at: now,
  };
  store.accounts.set(account.account_id, clone(account));
  store.principals.set(principal.principal_id, clone(principal));
  store.memberships.set(`${account.account_id}\u0000${principal.principal_id}`, clone(membership));

  return {
    store,
    principals,
    accounts,
    memberships,
    connections,
    routes,
    policies,
    tasks,
    decisions,
    executions,
    usage,
    audit,
  };
}

function estimateRouteCost(route: ModelRoute): number {
  const inputCostPer1k = route.pricing.input_cost_per_1k_tokens;
  const outputCostPer1k = route.pricing.output_cost_per_1k_tokens;
  const defaultInputTokens = 1000;
  const defaultOutputTokens = 500;
  return (
    (defaultInputTokens / 1000) * inputCostPer1k + (defaultOutputTokens / 1000) * outputCostPer1k
  );
}

function startOfDay(value: Date): Date {
  const result = new Date(value);
  result.setHours(0, 0, 0, 0);
  return result;
}

function startOfMonth(value: Date): Date {
  const result = new Date(value);
  result.setDate(1);
  result.setHours(0, 0, 0, 0);
  return result;
}

function startOfRange(value: Date, timeRange: 'today' | 'week' | 'month'): Date {
  if (timeRange === 'today') return startOfDay(value);
  const result = new Date(value);
  result.setDate(result.getDate() - (timeRange === 'week' ? 7 : 30));
  return result;
}

function toPublicRoute(route: ModelRoute): PublicRouteProjection {
  return {
    route_id: route.route_id,
    route_type: route.route_type,
    connection_id: route.connection_id,
    source_id: route.source_id,
    source_provider: route.source_provider,
    source_gateway: route.source_gateway,
    capabilities: [...route.capabilities],
    pricing: {
      input_cost_per_1k_tokens: route.pricing.input_cost_per_1k_tokens,
      output_cost_per_1k_tokens: route.pricing.output_cost_per_1k_tokens,
      currency: route.pricing.currency,
      units: route.pricing.units,
      source: route.pricing.source,
      pricing_status: route.pricing.pricing_status,
      effective_at: route.pricing.effective_at.toISOString(),
      refreshed_at: route.pricing.refreshed_at.toISOString(),
      version: route.pricing.version,
    },
    availability_status: route.availability_status,
    provenance: SYNTHETIC_DATA_MODE,
  };
}

function toPublicDecision(decision: RoutingDecision): PublicRoutingDecision {
  return {
    decision_id: decision.decision_id,
    task_id: decision.task_id,
    policy_id: decision.policy_id,
    policy_version: decision.policy_version,
    evaluated_routes: [...decision.evaluated_routes],
    admissible_routes: [...decision.admissible_routes],
    selected_route_id: decision.selected_route_id,
    route_snapshot: decision.route_snapshot ? clone(decision.route_snapshot) : null,
    estimated_cost: decision.estimated_cost,
    rejection_reasons: clone(decision.rejection_reasons),
    decided_at: decision.decided_at.toISOString(),
    parent_decision_id: decision.parent_decision_id ?? null,
    fallback_reason: decision.fallback_reason ?? null,
  };
}

function toPublicAttempt(attempt: ExecutionAttempt): PublicAttemptProjection {
  return {
    attempt_id: attempt.attempt_id,
    execution_id: attempt.execution_id,
    task_id: attempt.task_id,
    decision_id: attempt.decision_id,
    status: attempt.status,
    retry_count: attempt.retry_count,
    verification_outcome: attempt.verification_outcome,
    failure_code: attempt.failure_code,
    started_at: attempt.started_at?.toISOString() ?? null,
    completed_at: attempt.completed_at?.toISOString() ?? null,
    cancel_requested_at: attempt.cancel_requested_at?.toISOString() ?? null,
    cancelled_at: attempt.cancelled_at?.toISOString() ?? null,
    parent_attempt_id: attempt.parent_attempt_id,
  };
}

export function createSyntheticGPTRouterApplication(
  options: SyntheticApplicationOptions = {}
): GPTRouterApplication {
  const clock = options.clock ?? (() => new Date());
  const repositories = createSyntheticRepositories(clock(), {
    audit_failure_mode: options.audit_failure_mode,
  });
  const budgetEnforcer = new BudgetEnforcer(repositories.usage);
  const routingEngine = new RoutingEngine({
    checkBudget: (account_id, estimated_cost, policy) =>
      budgetEnforcer.checkBudget(account_id, estimated_cost, policy),
    estimateCost: (route) => estimateRouteCost(route),
    getConnection: (connection_id) => repositories.connections.getConnection(connection_id),
  });
  const fallbackPlanner: FallbackPlanner = {
    async planFallback({ task, original_decision, excluded_route_ids }) {
      const policy = await repositories.policies.getPolicy(original_decision.policy_id);
      if (!policy || policy.account_id !== task.account_id) return null;
      const excluded = new Set(excluded_route_ids);
      const routes = (await repositories.routes.listRoutes(task.account_id)).filter(
        (route) => !excluded.has(route.route_id)
      );
      const decision = await routingEngine.planRoute(task, policy, routes);
      return decision.selected_route_id ? decision : null;
    },
  };
  const authorization = new AccountAuthorizationService({
    accounts: repositories.accounts,
    memberships: repositories.memberships,
  });
  const syntheticContext: AuthorizedExecutionContext = {
    principal: {
      principal_id: 'principal-synthetic-v0',
      issuer: SYNTHETIC_ISSUER,
      subject: 'principal-synthetic-v0',
      created_at: new Date(),
      updated_at: new Date(),
    },
    account: {
      account_id: SYNTHETIC_ACCOUNT_ID,
      name: 'Synthetic V0.1 account',
      created_at: new Date(),
      updated_at: new Date(),
    },
    membership: {
      membership_id: 'membership-synthetic-v0',
      account_id: SYNTHETIC_ACCOUNT_ID,
      principal_id: 'principal-synthetic-v0',
      role: 'owner',
      status: 'active',
      created_at: new Date(),
      updated_at: new Date(),
    },
  };

  // Build provider adapter registry for fake adapters
  let executor: ExecutionExecutor = options.executor ?? new SyntheticExecutor();
  let verifier: ExecutionVerifier = options.verifier ?? new DeterministicVerifier();

  if (options.provider_execution_enabled) {
    // Create fake adapter registry with default adapter for testing
    const registry = new DefaultProviderAdapterRegistry();
    const fakeAdapter = new FakeProviderAdapter({ provider: 'synthetic-provider' });
    registry.registerAdapter('synthetic-provider-alpha', fakeAdapter);
    registry.registerAdapter('synthetic-provider-beta', fakeAdapter);
    registry.setDefaultAdapter(fakeAdapter);
    const credentialResolver = options.credentialResolver ?? { resolveCredential: async () => '' };
    executor = new AdapterExecutionCoordinatorBridge({ registry, credentialResolver });
    verifier = new AdapterExecutionVerifier();
  }

  const executionCoordinator = new ExecutionCoordinator({
    repositories: {
      tasks: repositories.tasks,
      decisions: repositories.decisions,
      policies: repositories.policies,
      executions: repositories.executions,
      usage: repositories.usage,
      audit: repositories.audit,
    } satisfies ExecutionCoordinatorRepositories,
    budgetEnforcer,
    executor,
    verifier,
    fallbackPlanner,
    onAuditFailure: () => {
      repositories.store.auditFailureCount += 1;
    },
  });

  async function decisionsForAccount(account_id: string): Promise<RoutingDecision[]> {
    const taskIds = new Set(
      [...repositories.store.tasks.values()]
        .filter((task) => task.account_id === account_id)
        .map((task) => task.task_id)
    );
    return [...repositories.store.decisions.values()]
      .filter((decision) => taskIds.has(decision.task_id))
      .map(clone);
  }

  async function attemptsForAccount(account_id: string): Promise<ExecutionAttempt[]> {
    const tasks = await repositories.tasks.listTasks(account_id);
    const attempts = await Promise.all(
      tasks.map((task) => repositories.executions.listAttemptsForTask(task.task_id))
    );
    return attempts.flat();
  }

  function contextOrSynthetic(context: AuthorizedExecutionContext | undefined) {
    return context ?? syntheticContext;
  }

  return {
    account_id: SYNTHETIC_ACCOUNT_ID,

    async listRoutes(query = {}, context) {
      const accountId = contextOrSynthetic(context).account.account_id;
      const routes = await repositories.routes.listRoutes(accountId);
      return routes
        .filter((route) =>
          query.capability_filter
            ? query.capability_filter.every((capability) => route.capabilities.includes(capability))
            : true
        )
        .filter((route) =>
          query.provider_filter ? route.source_provider === query.provider_filter : true
        )
        .map(toPublicRoute);
    },

    async planTask(request, context) {
      const accountId = contextOrSynthetic(context).account.account_id;
      const policy = await repositories.policies.getDefaultPolicy(accountId);
      if (!policy) throw new Error('Synthetic routing policy is unavailable');

      const task = await repositories.tasks.createTask({
        task_id: `task_${generateId()}`,
        account_id: accountId,
        description: request.description,
        requirements: { capabilities: [...request.required_capabilities] },
        status: 'planning',
      });
      const routes = await repositories.routes.listRoutes(accountId);
      const decision = await routingEngine.planRoute(task, policy, routes);
      const persistedDecision = await repositories.decisions.createDecision(decision);
      const selectedRoute = persistedDecision.selected_route_id
        ? (routes.find((route) => route.route_id === persistedDecision.selected_route_id) ?? null)
        : null;

      return {
        task_id: task.task_id,
        decision_id: persistedDecision.decision_id,
        status: 'planning',
        description: task.description,
        required_capabilities: [...task.requirements.capabilities],
        ordering_strategy: request.ordering_strategy,
        selected_route: selectedRoute ? toPublicRoute(selectedRoute) : null,
        estimated_cost: persistedDecision.estimated_cost,
        actual_cost: 0,
        data_mode: SYNTHETIC_DATA_MODE,
        decided_at: persistedDecision.decided_at.toISOString(),
        note: 'Planning decision only. No provider execution or spending occurs.',
      };
    },

    async getTask(task_id, context) {
      const accountId = contextOrSynthetic(context).account.account_id;
      const task = await repositories.tasks.getTask(task_id);
      if (!task || task.account_id !== accountId) return null;
      const decisions = await repositories.decisions.listDecisionsForTask(task.task_id);
      const attempts = await repositories.executions.listAttemptsForTask(task.task_id);
      const usage = await repositories.usage.listUsageForAccount(accountId);
      const attemptIds = new Set(attempts.map((attempt) => attempt.attempt_id));
      const taskUsage = usage.filter((record) => attemptIds.has(record.attempt_id));
      const latestDecision = decisions.at(-1) ?? null;
      const latestAttempt = attempts.at(-1) ?? null;
      const estimatedCost = latestDecision?.estimated_cost ?? null;
      const actualCost = taskUsage.reduce((sum, record) => sum + (record.actual_cost ?? 0), 0);
      const unknownCostAttemptCount = taskUsage.filter(
        (record) => record.actual_cost === null
      ).length;
      const auditStatus = {
        audit_degraded: repositories.store.auditFailureCount > 0,
        audit_failure_count: repositories.store.auditFailureCount,
      };
      const attemptTree = attempts.map((attempt) => ({
        attempt_id: attempt.attempt_id,
        execution_id: attempt.execution_id,
        parent_attempt_id: attempt.parent_attempt_id,
        decision_id: attempt.decision_id,
        status: attempt.status,
        retry_count: attempt.retry_count,
        verification_outcome: attempt.verification_outcome,
        failure_code: attempt.failure_code,
        started_at: attempt.started_at?.toISOString() ?? null,
        completed_at: attempt.completed_at?.toISOString() ?? null,
        cancel_requested_at: attempt.cancel_requested_at?.toISOString() ?? null,
        cancelled_at: attempt.cancelled_at?.toISOString() ?? null,
      }));
      const decisionTree = decisions.map((decision) => ({
        decision_id: decision.decision_id,
        parent_decision_id: decision.parent_decision_id ?? null,
        fallback_reason: decision.fallback_reason ?? null,
        selected_route_id: decision.selected_route_id,
        estimated_cost: decision.estimated_cost,
        decided_at: decision.decided_at.toISOString(),
      }));
      return {
        task: {
          task_id: task.task_id,
          account_id: task.account_id,
          description: task.description,
          requirements: clone(task.requirements),
          status: task.status,
          created_at: task.created_at.toISOString(),
        },
        routing_decisions: decisions.map(toPublicDecision),
        decision_tree: decisionTree,
        latest_decision: latestDecision ? toPublicDecision(latestDecision) : null,
        attempts: attempts.map(toPublicAttempt),
        attempt_tree: attemptTree,
        latest_attempt: latestAttempt ? toPublicAttempt(latestAttempt) : null,
        execution_id: latestAttempt?.execution_id ?? null,
        retry_count: attempts.reduce((sum, attempt) => sum + attempt.retry_count, 0),
        fallback_count: decisions.filter((decision) => decision.parent_decision_id).length,
        audit_degraded: auditStatus.audit_degraded,
        actual_cost: actualCost,
        known_actual_cost: actualCost,
        unknown_cost_attempt_count: unknownCostAttemptCount,
        cost_complete: unknownCostAttemptCount === 0,
        estimated_cost: estimatedCost,
        cost_variance:
          estimatedCost === null || unknownCostAttemptCount > 0
            ? null
            : actualCost -
              attempts.reduce(
                (sum, attempt) =>
                  sum +
                  (decisions.find((decision) => decision.decision_id === attempt.decision_id)
                    ?.estimated_cost ?? 0),
                0
              ),
        execution_status: latestAttempt?.status ?? 'not_started',
        verification_outcome: latestAttempt?.verification_outcome ?? null,
        cancellation_status:
          latestAttempt?.status === 'cancelled'
            ? 'cancelled'
            : latestAttempt?.status === 'cancel_requested'
              ? 'requested'
              : 'not_requested',
        data_mode: SYNTHETIC_DATA_MODE,
      };
    },

    async getUsage(time_range = 'today', context) {
      const accountId = contextOrSynthetic(context).account.account_id;
      const now = clock();
      const start = startOfRange(now, time_range);
      const decisions = (await decisionsForAccount(accountId)).filter(
        (decision) => decision.decided_at >= start
      );
      const attempts = (await attemptsForAccount(accountId)).filter(
        (attempt) => attempt.created_at >= start
      );
      const usage = (await repositories.usage.listUsageForAccount(accountId)).filter(
        (record) => record.reconciled_at >= start
      );
      const executionRoots = new Set(attempts.map((attempt) => attempt.execution_id));
      const estimatedPlannedCost = decisions.reduce(
        (sum, decision) => sum + (decision.estimated_cost ?? 0),
        0
      );
      const knownActualCost = usage.reduce((sum, record) => sum + (record.actual_cost ?? 0), 0);
      const unknownCostAttemptCount = usage.filter((record) => record.actual_cost === null).length;
      return {
        time_range,
        planning_requests: decisions.length,
        execution_requests: attempts.length,
        execution_roots: executionRoots.size,
        total_attempts: attempts.length,
        successful_executions: attempts.filter((attempt) => attempt.status === 'completed').length,
        failed_attempts: attempts.filter((attempt) => attempt.status === 'failed').length,
        cancelled_attempts: attempts.filter((attempt) => attempt.status === 'cancelled').length,
        actual_cost: knownActualCost,
        known_actual_cost: knownActualCost,
        unknown_cost_attempt_count: unknownCostAttemptCount,
        cost_complete: unknownCostAttemptCount === 0,
        estimated_planned_cost: estimatedPlannedCost,
        actual_usage_records: usage.length,
        cost_variance:
          unknownCostAttemptCount === 0
            ? usage.reduce((sum, record) => sum + (record.cost_variance ?? 0), 0)
            : 0,
        audit_degraded: repositories.store.auditFailureCount > 0,
        data_mode: SYNTHETIC_DATA_MODE,
        note: 'Synthetic execution only. Actual provider execution and paid calls remain disabled.',
      };
    },

    async getDashboardSummary(context) {
      const accountId = contextOrSynthetic(context).account.account_id;
      const decisions = await decisionsForAccount(accountId);
      const attempts = await attemptsForAccount(accountId);
      const usage = await repositories.usage.listUsageForAccount(accountId);
      const taskCount = (await repositories.tasks.listTasks(accountId)).length;
      const routeCount = (await repositories.routes.listRoutes(accountId)).length;
      const executionRoots = new Set(attempts.map((attempt) => attempt.execution_id));
      return {
        data_source: SYNTHETIC_DATA_MODE,
        route_count: routeCount,
        task_count: taskCount,
        decision_count: decisions.length,
        execution_count: executionRoots.size,
        successful_execution_count: attempts.filter((attempt) => attempt.status === 'completed')
          .length,
        failed_attempt_count: attempts.filter((attempt) => attempt.status === 'failed').length,
        cancelled_attempt_count: attempts.filter((attempt) => attempt.status === 'cancelled')
          .length,
        actual_spend: usage.reduce((sum, record) => sum + (record.actual_cost ?? 0), 0),
        estimated_planned_cost: decisions.reduce(
          (sum, decision) => sum + (decision.estimated_cost ?? 0),
          0
        ),
        retry_count: attempts.reduce((sum, attempt) => sum + attempt.retry_count, 0),
        fallback_count: decisions.filter((decision) => decision.parent_decision_id).length,
        audit_degraded: repositories.store.auditFailureCount > 0,
        audit_failure_count: repositories.store.auditFailureCount,
        synthetic_execution_enabled: true,
        provider_execution_enabled: false,
        paid_calls_enabled: false,
      };
    },

    async runTask(request, context) {
      const executionContext =
        context ?? (options.requireAuthorizedExecution ? undefined : syntheticContext);
      if (!executionContext) throw new AuthorizationError();
      return executionCoordinator.runTask(executionContext, request);
    },

    async cancelExecution(attempt_id, context) {
      const executionContext =
        context ?? (options.requireAuthorizedExecution ? undefined : syntheticContext);
      if (!executionContext) throw new AuthorizationError();
      return executionCoordinator.cancelExecution(executionContext, attempt_id);
    },

    async authorizeVerifiedIdentity(identity, minimumRole = 'member') {
      const principal = await repositories.principals.getPrincipalBySubject(
        identity.issuer,
        identity.subject
      );
      if (!principal) throw new AuthorizationError();
      return authorization.authorize(principal, identity.account_id, minimumRole);
    },

    async getAuditEvents(context, limit = 50, offset = 0, event_type) {
      const accountId = contextOrSynthetic(context).account.account_id;
      const result = await repositories.audit.listEvents(accountId, {
        limit: Math.min(100, Math.max(1, limit)),
        offset: Math.max(0, offset),
        event_type,
      });
      return result.events.map((event) => ({
        event_id: event.event_id,
        event_type: event.event_type,
        actor: event.actor,
        resource_type: event.resource_type,
        resource_id: event.resource_id,
        metadata: safeAuditMetadata(event.metadata),
        timestamp: event.timestamp.toISOString(),
      }));
    },

    getAuditStatus() {
      return {
        audit_degraded: repositories.store.auditFailureCount > 0,
        audit_failure_count: repositories.store.auditFailureCount,
      };
    },

    getSyntheticAuthorizedContext() {
      return clone(syntheticContext);
    },
  };
}
