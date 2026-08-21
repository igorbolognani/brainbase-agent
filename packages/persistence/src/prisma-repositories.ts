import { PrismaClient, Prisma } from '@prisma/client';
import type {
  Account,
  AccountMembership,
  AccountRepository,
  AuditEvent,
  AuditRepository,
  AvailabilityStatus,
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
} from '@gptrouter/contracts';

type PrismaTransaction = Prisma.TransactionClient;

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function isUniqueError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function idempotencyConflict(): Error & { code: string } {
  const error = new Error('idempotency_conflict') as Error & { code: string };
  error.code = 'idempotency_conflict';
  return error;
}

function rowToPrincipal(row: {
  principal_id: string;
  issuer: string;
  subject: string;
  host: string | null;
  created_at: Date;
  updated_at: Date;
}): Principal {
  return {
    principal_id: row.principal_id,
    issuer: row.issuer,
    subject: row.subject,
    host: row.host ?? undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function rowToAccount(row: {
  account_id: string;
  name: string;
  created_at: Date;
  updated_at: Date;
}): Account {
  return {
    account_id: row.account_id,
    name: row.name,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function rowToMembership(row: {
  membership_id: string;
  account_id: string;
  principal_id: string;
  role: string;
  status: string;
  created_at: Date;
  updated_at: Date;
}): AccountMembership {
  return {
    membership_id: row.membership_id,
    account_id: row.account_id,
    principal_id: row.principal_id,
    role: row.role as AccountMembership['role'],
    status: row.status as AccountMembership['status'],
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function rowToProviderConnection(row: {
  connection_id: string;
  account_id: string;
  provider: string;
  status: string;
  credential_reference: string;
  created_at: Date;
  updated_at: Date;
}): Connection {
  return {
    type: 'provider',
    connection_id: row.connection_id,
    account_id: row.account_id,
    provider: row.provider,
    status: row.status as Connection['status'],
    credential_reference: row.credential_reference,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function rowToGatewayConnection(row: {
  connection_id: string;
  account_id: string;
  gateway_url: string;
  gateway_type: string;
  status: string;
  credential_reference: string;
  created_at: Date;
  updated_at: Date;
}): Connection {
  return {
    type: 'gateway',
    connection_id: row.connection_id,
    account_id: row.account_id,
    gateway_url: row.gateway_url,
    gateway_type: row.gateway_type,
    status: row.status as Connection['status'],
    credential_reference: row.credential_reference,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function rowToRoute(row: {
  route_id: string;
  route_type: string;
  provider_connection_id: string | null;
  gateway_connection_id: string | null;
  source_id: string;
  source_provider: string | null;
  source_gateway: string | null;
  capabilities: unknown;
  pricing_input: number;
  pricing_output: number;
  pricing_currency: string;
  pricing_units: string;
  pricing_source: string;
  pricing_effective_at: Date;
  pricing_refreshed_at: Date;
  pricing_version: string;
  availability_status: string;
  created_at: Date;
  updated_at: Date;
}): ModelRoute {
  return {
    route_id: row.route_id,
    route_type: row.route_type as ModelRoute['route_type'],
    connection_id: row.provider_connection_id ?? row.gateway_connection_id ?? '',
    source_id: row.source_id,
    source_provider: row.source_provider ?? undefined,
    source_gateway: row.source_gateway ?? undefined,
    capabilities: Array.isArray(row.capabilities)
      ? row.capabilities.filter((v): v is string => typeof v === 'string')
      : [],
    pricing: {
      input_cost_per_1k_tokens: row.pricing_input,
      output_cost_per_1k_tokens: row.pricing_output,
      currency: row.pricing_currency,
      units: row.pricing_units,
      source: row.pricing_source,
      effective_at: row.pricing_effective_at,
      refreshed_at: row.pricing_refreshed_at,
      version: row.pricing_version,
    },
    availability_status: row.availability_status as ModelRoute['availability_status'],
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function rowToPolicy(row: {
  policy_id: string;
  account_id: string;
  name: string;
  ordering_strategy: string;
  admissibility_rules: unknown;
  budget_constraints: unknown;
  retry_policy: unknown;
  manual_override_allowed: boolean;
  version: number;
  created_at: Date;
  updated_at: Date;
}): RoutingPolicy {
  return {
    policy_id: row.policy_id,
    account_id: row.account_id,
    name: row.name,
    ordering_strategy: row.ordering_strategy as RoutingPolicy['ordering_strategy'],
    admissibility_rules: row.admissibility_rules as RoutingPolicy['admissibility_rules'],
    budget_constraints: row.budget_constraints as RoutingPolicy['budget_constraints'],
    retry_policy: row.retry_policy as RoutingPolicy['retry_policy'],
    manual_override_allowed: row.manual_override_allowed,
    version: row.version,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function rowToTask(row: {
  task_id: string;
  account_id: string;
  description: string;
  requirements: unknown;
  status: string;
  created_at: Date;
}): Task {
  return {
    task_id: row.task_id,
    account_id: row.account_id,
    description: row.description,
    requirements: row.requirements as Task['requirements'],
    status: row.status as Task['status'],
    created_at: row.created_at,
  };
}

function rowToDecision(row: {
  decision_id: string;
  task_id: string;
  policy_id: string;
  policy_version: number;
  evaluated_routes: unknown;
  admissible_routes: unknown;
  selected_route_id: string | null;
  route_snapshot: unknown;
  rejection_reasons: unknown;
  estimated_cost: number | null;
  decided_at: Date;
  parent_decision_id: string | null;
  fallback_reason: string | null;
  ordering_strategy_unsupported: boolean | null;
}): RoutingDecision {
  return {
    decision_id: row.decision_id,
    task_id: row.task_id,
    policy_id: row.policy_id,
    policy_version: row.policy_version,
    evaluated_routes: row.evaluated_routes as string[],
    admissible_routes: row.admissible_routes as string[],
    selected_route_id: row.selected_route_id,
    route_snapshot: row.route_snapshot as RoutingDecision['route_snapshot'],
    rejection_reasons: row.rejection_reasons as RoutingDecision['rejection_reasons'],
    estimated_cost: row.estimated_cost,
    decided_at: row.decided_at,
    parent_decision_id: row.parent_decision_id,
    fallback_reason: row.fallback_reason,
    ordering_strategy_unsupported: row.ordering_strategy_unsupported ?? undefined,
  };
}

function rowToExecution(row: {
  execution_id: string;
  account_id: string;
  task_id: string;
  root_decision_id: string;
  idempotency_key: string;
  command_fingerprint?: string | null;
  status: string;
  created_at: Date;
}): Execution {
  return {
    execution_id: row.execution_id,
    account_id: row.account_id,
    task_id: row.task_id,
    root_decision_id: row.root_decision_id,
    idempotency_key: row.idempotency_key,
    command_fingerprint: row.command_fingerprint ?? undefined,
    status: row.status as Execution['status'],
    created_at: row.created_at,
  };
}

function rowToAttempt(row: {
  attempt_id: string;
  execution_id: string;
  account_id: string;
  task_id: string;
  decision_id: string;
  idempotency_key: string;
  status: string;
  started_at: Date | null;
  completed_at: Date | null;
  cancel_requested_at: Date | null;
  cancelled_at: Date | null;
  retry_count: number;
  retry_policy: unknown;
  parent_attempt_id: string | null;
  verification_outcome: string | null;
  failure_code: string | null;
  created_at: Date;
}): ExecutionAttempt {
  return {
    attempt_id: row.attempt_id,
    execution_id: row.execution_id,
    account_id: row.account_id,
    task_id: row.task_id,
    decision_id: row.decision_id,
    idempotency_key: row.idempotency_key,
    status: row.status as ExecutionAttempt['status'],
    started_at: row.started_at,
    completed_at: row.completed_at,
    cancel_requested_at: row.cancel_requested_at,
    cancelled_at: row.cancelled_at,
    retry_count: row.retry_count,
    retry_policy: row.retry_policy as ExecutionAttempt['retry_policy'],
    parent_attempt_id: row.parent_attempt_id,
    verification_outcome: row.verification_outcome as ExecutionAttempt['verification_outcome'],
    failure_code: row.failure_code,
    created_at: row.created_at,
  };
}

function rowToUsage(row: {
  usage_id: string;
  account_id: string;
  attempt_id: string;
  provider_usage_data: unknown;
  actual_cost: number | null;
  cost_breakdown: unknown;
  input_tokens: number | null;
  output_tokens: number | null;
  reconciled_at: Date;
  cost_variance: number | null;
}): UsageRecord {
  return {
    usage_id: row.usage_id,
    account_id: row.account_id,
    attempt_id: row.attempt_id,
    provider_usage_data: row.provider_usage_data as Record<string, unknown>,
    actual_cost: row.actual_cost,
    cost_breakdown: row.cost_breakdown as Record<string, unknown>,
    tokens_used:
      row.input_tokens !== null && row.output_tokens !== null
        ? { input: row.input_tokens, output: row.output_tokens }
        : null,
    reconciled_at: row.reconciled_at,
    cost_variance: row.cost_variance,
  };
}

function rowToAudit(row: {
  event_id: string;
  account_id: string | null;
  event_type: string;
  actor: string;
  resource_type: string | null;
  resource_id: string | null;
  metadata: unknown;
  timestamp: Date;
}): AuditEvent {
  return {
    event_id: row.event_id,
    account_id: row.account_id,
    event_type: row.event_type,
    actor: row.actor,
    resource_type: row.resource_type,
    resource_id: row.resource_id,
    metadata: row.metadata as Record<string, unknown>,
    timestamp: row.timestamp,
  };
}

export class PrismaPrincipalRepository implements PrincipalRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getPrincipal(principal_id: string): Promise<Principal | null> {
    const row = await this.prisma.principal.findUnique({ where: { principal_id } });
    return row ? rowToPrincipal(row) : null;
  }

  async getPrincipalBySubject(issuer: string, subject: string): Promise<Principal | null> {
    const row = await this.prisma.principal.findUnique({
      where: { issuer_subject: { issuer, subject } },
    });
    return row ? rowToPrincipal(row) : null;
  }
}

export class PrismaAccountRepository implements AccountRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getAccount(account_id: string): Promise<Account | null> {
    const row = await this.prisma.account.findUnique({ where: { account_id } });
    return row ? rowToAccount(row) : null;
  }

  async createAccount(account: Omit<Account, 'created_at'>): Promise<Account> {
    const row = await this.prisma.account.create({
      data: { account_id: account.account_id, name: account.name, updated_at: account.updated_at },
    });
    return rowToAccount(row);
  }
}

export class PrismaMembershipRepository implements MembershipRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getMembership(account_id: string, principal_id: string): Promise<AccountMembership | null> {
    const row = await this.prisma.accountMembership.findUnique({
      where: { account_id_principal_id: { account_id, principal_id } },
    });
    return row ? rowToMembership(row) : null;
  }

  async listMembershipsForPrincipal(principal_id: string): Promise<AccountMembership[]> {
    const rows = await this.prisma.accountMembership.findMany({ where: { principal_id } });
    return rows.map(rowToMembership);
  }
}

export class PrismaConnectionRepository implements ConnectionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listConnections(account_id: string): Promise<Connection[]> {
    const [providers, gateways] = await Promise.all([
      this.prisma.providerConnection.findMany({ where: { account_id } }),
      this.prisma.gatewayConnection.findMany({ where: { account_id } }),
    ]);
    return [...providers.map(rowToProviderConnection), ...gateways.map(rowToGatewayConnection)];
  }

  async getConnection(connection_id: string): Promise<Connection | null> {
    const provider = await this.prisma.providerConnection.findUnique({ where: { connection_id } });
    if (provider) return rowToProviderConnection(provider);
    const gateway = await this.prisma.gatewayConnection.findUnique({ where: { connection_id } });
    return gateway ? rowToGatewayConnection(gateway) : null;
  }

  async createConnection(
    connection: Omit<Connection, 'created_at' | 'updated_at'>
  ): Promise<Connection> {
    const normalized = connection as Connection;
    if (normalized.type === 'provider') {
      const row = await this.prisma.providerConnection.create({
        data: {
          connection_id: normalized.connection_id,
          account_id: normalized.account_id,
          provider: normalized.provider,
          status: normalized.status,
          credential_reference: normalized.credential_reference,
        },
      });
      return rowToProviderConnection(row);
    }
    const row = await this.prisma.gatewayConnection.create({
      data: {
        connection_id: connection.connection_id,
        account_id: normalized.account_id,
        gateway_url: normalized.gateway_url,
        gateway_type: normalized.gateway_type,
        status: normalized.status,
        credential_reference: normalized.credential_reference,
      },
    });
    return rowToGatewayConnection(row);
  }

  async updateConnectionStatus(connection_id: string, status: Connection['status']): Promise<void> {
    const provider = await this.prisma.providerConnection.updateMany({
      where: { connection_id },
      data: { status },
    });
    if (provider.count > 0) return;
    await this.prisma.gatewayConnection.updateMany({ where: { connection_id }, data: { status } });
  }

  async deleteConnection(connection_id: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.providerConnection.deleteMany({ where: { connection_id } }),
      this.prisma.gatewayConnection.deleteMany({ where: { connection_id } }),
    ]);
  }
}

export class PrismaRouteRepository implements RouteRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listRoutes(account_id: string): Promise<ModelRoute[]> {
    const rows = await this.prisma.modelRoute.findMany({
      where: {
        OR: [{ provider_connection: { account_id } }, { gateway_connection: { account_id } }],
      },
    });
    return rows.map(rowToRoute);
  }

  async getRoute(route_id: string): Promise<ModelRoute | null> {
    const row = await this.prisma.modelRoute.findUnique({ where: { route_id } });
    return row ? rowToRoute(row) : null;
  }

  async getRoutesForConnection(connection_id: string): Promise<ModelRoute[]> {
    const rows = await this.prisma.modelRoute.findMany({
      where: {
        OR: [{ provider_connection_id: connection_id }, { gateway_connection_id: connection_id }],
      },
    });
    return rows.map(rowToRoute);
  }

  async updateRouteAvailability(route_id: string, status: AvailabilityStatus): Promise<void> {
    await this.prisma.modelRoute.updateMany({
      where: { route_id },
      data: { availability_status: status },
    });
  }
}

export class PrismaPolicyRepository implements PolicyRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getPolicy(policy_id: string): Promise<RoutingPolicy | null> {
    const row = await this.prisma.routingPolicy.findUnique({ where: { policy_id } });
    return row ? rowToPolicy(row) : null;
  }

  async getDefaultPolicy(account_id: string): Promise<RoutingPolicy | null> {
    const row = await this.prisma.routingPolicy.findFirst({
      where: { account_id },
      orderBy: { version: 'desc' },
    });
    return row ? rowToPolicy(row) : null;
  }

  async listPolicies(account_id: string): Promise<RoutingPolicy[]> {
    const rows = await this.prisma.routingPolicy.findMany({
      where: { account_id },
      orderBy: { version: 'desc' },
    });
    return rows.map(rowToPolicy);
  }

  async createPolicy(
    policy: Omit<RoutingPolicy, 'created_at' | 'updated_at'>
  ): Promise<RoutingPolicy> {
    const row = await this.prisma.routingPolicy.create({
      data: {
        policy_id: policy.policy_id,
        account_id: policy.account_id,
        name: policy.name,
        ordering_strategy: policy.ordering_strategy,
        admissibility_rules: json(policy.admissibility_rules),
        budget_constraints: json(policy.budget_constraints),
        retry_policy: policy.retry_policy ? json(policy.retry_policy) : undefined,
        manual_override_allowed: policy.manual_override_allowed,
        version: policy.version,
      },
    });
    return rowToPolicy(row);
  }

  async updatePolicy(policy: RoutingPolicy): Promise<RoutingPolicy> {
    const row = await this.prisma.routingPolicy.update({
      where: { policy_id: policy.policy_id },
      data: {
        name: policy.name,
        ordering_strategy: policy.ordering_strategy,
        admissibility_rules: json(policy.admissibility_rules),
        budget_constraints: json(policy.budget_constraints),
        retry_policy: policy.retry_policy ? json(policy.retry_policy) : Prisma.JsonNull,
        manual_override_allowed: policy.manual_override_allowed,
        version: policy.version,
      },
    });
    return rowToPolicy(row);
  }
}

export class PrismaTaskRepository implements TaskRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getTask(task_id: string): Promise<Task | null> {
    const row = await this.prisma.task.findUnique({ where: { task_id } });
    return row ? rowToTask(row) : null;
  }

  async listTasks(account_id: string): Promise<Task[]> {
    const rows = await this.prisma.task.findMany({
      where: { account_id },
      orderBy: { created_at: 'asc' },
    });
    return rows.map(rowToTask);
  }

  async createTask(task: Omit<Task, 'created_at'>): Promise<Task> {
    const row = await this.prisma.task.create({
      data: {
        task_id: task.task_id,
        account_id: task.account_id,
        description: task.description,
        requirements: json(task.requirements),
        status: task.status,
      },
    });
    return rowToTask(row);
  }

  async updateTaskStatus(
    task_id: string,
    status: Task['status'],
    expected_status?: Task['status']
  ): Promise<void> {
    const row = await this.prisma.task.updateMany({
      where: { task_id, ...(expected_status ? { status: expected_status } : {}) },
      data: { status },
    });
    if (row.count === 0) throw new Error('state_conflict');
  }
}

export class PrismaDecisionRepository implements DecisionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getDecision(decision_id: string): Promise<RoutingDecision | null> {
    const row = await this.prisma.routingDecision.findUnique({ where: { decision_id } });
    return row ? rowToDecision(row) : null;
  }

  async createDecision(decision: Omit<RoutingDecision, 'decided_at'>): Promise<RoutingDecision> {
    const row = await this.prisma.routingDecision.create({
      data: {
        decision_id: decision.decision_id,
        task_id: decision.task_id,
        policy_id: decision.policy_id,
        policy_version: decision.policy_version,
        evaluated_routes: json(decision.evaluated_routes),
        admissible_routes: json(decision.admissible_routes),
        selected_route_id: decision.selected_route_id,
        route_snapshot: decision.route_snapshot ? json(decision.route_snapshot) : undefined,
        rejection_reasons: json(decision.rejection_reasons),
        estimated_cost: decision.estimated_cost,
        parent_decision_id: decision.parent_decision_id,
        fallback_reason: decision.fallback_reason,
        ordering_strategy_unsupported: decision.ordering_strategy_unsupported,
      },
    });
    return rowToDecision(row);
  }

  async listDecisionsForTask(task_id: string): Promise<RoutingDecision[]> {
    const rows = await this.prisma.routingDecision.findMany({
      where: { task_id },
      orderBy: { decided_at: 'asc' },
    });
    return rows.map(rowToDecision);
  }
}

export class PrismaExecutionRepository implements ExecutionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getExecution(execution_id: string): Promise<Execution | null> {
    const row = await this.prisma.execution.findUnique({ where: { execution_id } });
    return row ? rowToExecution(row) : null;
  }

  async getExecutionByIdempotencyKey(
    account_id: string,
    idempotency_key: string
  ): Promise<Execution | null> {
    const row = await this.prisma.execution.findUnique({
      where: { account_id_idempotency_key: { account_id, idempotency_key } },
    });
    return row ? rowToExecution(row) : null;
  }

  async createExecution(execution: Omit<Execution, 'created_at'>): Promise<Execution> {
    try {
      const row = await this.prisma.execution.create({
        data: {
          execution_id: execution.execution_id,
          account_id: execution.account_id,
          task_id: execution.task_id,
          root_decision_id: execution.root_decision_id,
          idempotency_key: execution.idempotency_key,
          command_fingerprint: execution.command_fingerprint,
          status: execution.status,
        },
      });
      return rowToExecution(row);
    } catch (error) {
      if (isUniqueError(error)) throw idempotencyConflict();
      throw error;
    }
  }

  async createExecutionWithRootAttempt(
    execution: Omit<Execution, 'created_at'>,
    attempt: Omit<ExecutionAttempt, 'created_at'>
  ): Promise<{ execution: Execution; attempt: ExecutionAttempt }> {
    try {
      return await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const executionRow = await tx.execution.create({
          data: {
            execution_id: execution.execution_id,
            account_id: execution.account_id,
            task_id: execution.task_id,
            root_decision_id: execution.root_decision_id,
            idempotency_key: execution.idempotency_key,
            command_fingerprint: execution.command_fingerprint,
            status: execution.status,
          },
        });
        const attemptRow = await tx.executionAttempt.create({
          data: {
            attempt_id: attempt.attempt_id,
            execution_id: attempt.execution_id,
            account_id: attempt.account_id,
            task_id: attempt.task_id,
            decision_id: attempt.decision_id,
            idempotency_key: attempt.idempotency_key,
            status: attempt.status,
            started_at: attempt.started_at,
            completed_at: attempt.completed_at,
            cancel_requested_at: attempt.cancel_requested_at,
            cancelled_at: attempt.cancelled_at,
            retry_count: attempt.retry_count,
            retry_policy: attempt.retry_policy ? json(attempt.retry_policy) : undefined,
            parent_attempt_id: attempt.parent_attempt_id,
            verification_outcome: attempt.verification_outcome,
            failure_code: attempt.failure_code,
          },
        });
        return { execution: rowToExecution(executionRow), attempt: rowToAttempt(attemptRow) };
      });
    } catch (error) {
      if (isUniqueError(error)) throw idempotencyConflict();
      throw error;
    }
  }

  async updateExecutionStatus(
    execution_id: string,
    status: Execution['status'],
    expected_status?: Execution['status']
  ): Promise<void> {
    const result = await this.prisma.execution.updateMany({
      where: { execution_id, ...(expected_status ? { status: expected_status } : {}) },
      data: { status },
    });
    if (result.count === 0) throw new Error('state_conflict');
  }

  async getAttempt(attempt_id: string): Promise<ExecutionAttempt | null> {
    const row = await this.prisma.executionAttempt.findUnique({ where: { attempt_id } });
    return row ? rowToAttempt(row) : null;
  }

  async getAttemptByIdempotencyKey(
    account_id: string,
    idempotency_key: string
  ): Promise<ExecutionAttempt | null> {
    const row = await this.prisma.executionAttempt.findFirst({
      where: { account_id, idempotency_key, parent_attempt_id: null },
      orderBy: { created_at: 'asc' },
    });
    return row ? rowToAttempt(row) : null;
  }

  async createAttempt(attempt: Omit<ExecutionAttempt, 'created_at'>): Promise<ExecutionAttempt> {
    const row = await this.prisma.executionAttempt.create({
      data: {
        attempt_id: attempt.attempt_id,
        execution_id: attempt.execution_id,
        account_id: attempt.account_id,
        task_id: attempt.task_id,
        decision_id: attempt.decision_id,
        idempotency_key: attempt.idempotency_key,
        status: attempt.status,
        started_at: attempt.started_at,
        completed_at: attempt.completed_at,
        cancel_requested_at: attempt.cancel_requested_at,
        cancelled_at: attempt.cancelled_at,
        retry_count: attempt.retry_count,
        retry_policy: attempt.retry_policy ? json(attempt.retry_policy) : undefined,
        parent_attempt_id: attempt.parent_attempt_id,
        verification_outcome: attempt.verification_outcome,
        failure_code: attempt.failure_code,
      },
    });
    return rowToAttempt(row);
  }

  async listAttemptsForTask(task_id: string): Promise<ExecutionAttempt[]> {
    const rows = await this.prisma.executionAttempt.findMany({
      where: { task_id },
      orderBy: { created_at: 'asc' },
    });
    return rows.map(rowToAttempt);
  }

  async updateAttemptStatus(
    attempt_id: string,
    status: ExecutionAttempt['status'],
    updates: Partial<ExecutionAttempt>,
    expected_status?: ExecutionAttempt['status']
  ): Promise<void> {
    const result = await this.prisma.executionAttempt.updateMany({
      where: { attempt_id, ...(expected_status ? { status: expected_status } : {}) },
      data: {
        status,
        started_at: updates.started_at,
        completed_at: updates.completed_at,
        cancel_requested_at: updates.cancel_requested_at,
        cancelled_at: updates.cancelled_at,
        retry_count: updates.retry_count,
        retry_policy: updates.retry_policy ? json(updates.retry_policy) : undefined,
        verification_outcome: updates.verification_outcome,
        failure_code: updates.failure_code,
      },
    });
    if (result.count === 0) throw new Error('state_conflict');
  }
}

export class PrismaUsageRepository implements UsageRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getUsage(usage_id: string): Promise<UsageRecord | null> {
    const row = await this.prisma.usageRecord.findUnique({ where: { usage_id } });
    return row ? rowToUsage(row) : null;
  }

  async getUsageForAttempt(attempt_id: string): Promise<UsageRecord | null> {
    const row = await this.prisma.usageRecord.findUnique({ where: { attempt_id } });
    return row ? rowToUsage(row) : null;
  }

  async createUsage(usage: Omit<UsageRecord, 'reconciled_at'>): Promise<UsageRecord> {
    const row = await this.prisma.usageRecord.create({
      data: {
        usage_id: usage.usage_id,
        account_id: usage.account_id,
        attempt_id: usage.attempt_id,
        provider_usage_data: json(usage.provider_usage_data),
        actual_cost: usage.actual_cost,
        cost_breakdown: json(usage.cost_breakdown),
        input_tokens: usage.tokens_used?.input,
        output_tokens: usage.tokens_used?.output,
        cost_variance: usage.cost_variance,
      },
    });
    return rowToUsage(row);
  }

  async listUsageForAccount(account_id: string): Promise<UsageRecord[]> {
    const rows = await this.prisma.usageRecord.findMany({
      where: { account_id },
      orderBy: { reconciled_at: 'asc' },
    });
    return rows.map(rowToUsage);
  }

  async getDailySpending(account_id: string): Promise<number> {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const result = await this.prisma.usageRecord.aggregate({
      where: { account_id, reconciled_at: { gte: start }, actual_cost: { not: null } },
      _sum: { actual_cost: true },
    });
    return result._sum.actual_cost ?? 0;
  }

  async getMonthlySpending(account_id: string): Promise<number> {
    const start = new Date();
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    const result = await this.prisma.usageRecord.aggregate({
      where: { account_id, reconciled_at: { gte: start }, actual_cost: { not: null } },
      _sum: { actual_cost: true },
    });
    return result._sum.actual_cost ?? 0;
  }
}

export class PrismaAuditRepository implements AuditRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async recordEvent(event: Omit<AuditEvent, 'timestamp'>): Promise<AuditEvent> {
    const row = await this.prisma.auditEvent.create({
      data: {
        event_id: event.event_id,
        account_id: event.account_id,
        event_type: event.event_type,
        actor: event.actor,
        resource_type: event.resource_type,
        resource_id: event.resource_id,
        metadata: json(event.metadata),
      },
    });
    return rowToAudit(row);
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
    const where = {
      account_id,
      ...(filters?.event_type ? { event_type: filters.event_type } : {}),
      ...(filters?.start_time || filters?.end_time
        ? {
            timestamp: {
              ...(filters.start_time ? { gte: filters.start_time } : {}),
              ...(filters.end_time ? { lte: filters.end_time } : {}),
            },
          }
        : {}),
    };
    const offset = Math.max(0, filters?.offset ?? 0);
    const limit = Math.min(100, Math.max(1, filters?.limit ?? 50));
    const [rows, total_count] = await Promise.all([
      this.prisma.auditEvent.findMany({
        where,
        orderBy: [{ timestamp: 'desc' }, { event_id: 'desc' }],
        skip: offset,
        take: limit,
      }),
      this.prisma.auditEvent.count({ where }),
    ]);
    return { events: rows.map(rowToAudit), total_count };
  }
}

export interface PrismaRepositories {
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

export function createPrismaRepositories(prisma: PrismaClient): PrismaRepositories {
  return {
    principals: new PrismaPrincipalRepository(prisma),
    accounts: new PrismaAccountRepository(prisma),
    memberships: new PrismaMembershipRepository(prisma),
    connections: new PrismaConnectionRepository(prisma),
    routes: new PrismaRouteRepository(prisma),
    policies: new PrismaPolicyRepository(prisma),
    tasks: new PrismaTaskRepository(prisma),
    decisions: new PrismaDecisionRepository(prisma),
    executions: new PrismaExecutionRepository(prisma),
    usage: new PrismaUsageRepository(prisma),
    audit: new PrismaAuditRepository(prisma),
  };
}
