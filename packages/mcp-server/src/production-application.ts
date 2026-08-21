import type {
  AccountMembership,
  AuthorizedExecutionContext,
  ExecutionAttempt,
  ModelRoute,
  RoutingDecision,
  Task,
} from '@gptrouter/contracts';
import { randomUUID } from 'node:crypto';
import {
  AdapterExecutionCoordinatorBridge,
  AdapterExecutionVerifier,
  BudgetEnforcer,
  DefaultProviderAdapterRegistry,
  DeterministicVerifier,
  ExecutionCoordinator,
  RoutingEngine,
  SyntheticExecutor,
  type CredentialResolver,
  type ExecutionCoordinatorRepositories,
  type ExecutionExecutor,
  type ExecutionVerifier,
  type FallbackPlanner,
} from '@gptrouter/domain';
import {
  AccountAuthorizationService,
  AuthorizationError,
  SafeGatewayDispatcher,
  sanitizeForPublicOutput,
} from '@gptrouter/security';
import {
  GeminiAdapter,
  GatewayProviderAdapter,
  getTrustedEndpoint,
  OpenAICompatibleAdapter,
} from '@gptrouter/provider-runtime';
import type {
  GPTRouterApplication,
  PublicAuditEvent,
  PublicAttemptProjection,
  PublicRouteProjection,
  PublicRoutingDecision,
  TaskProjection,
  VerifiedExecutionIdentity,
} from './application.js';
import { PRODUCTION_DATA_MODE } from './application.js';

export interface ProductionApplicationOptions {
  repositories: ProductionRepositories;
  credentialResolver: CredentialResolver;
  provider_execution_enabled?: boolean;
  fetch?: typeof globalThis.fetch;
  gatewayDispatcher?: SafeGatewayDispatcher;
  default_account_id?: string;
  clock?: () => Date;
}

export interface ProductionRepositories extends ExecutionCoordinatorRepositories {
  principals: import('@gptrouter/contracts').PrincipalRepository;
  accounts: import('@gptrouter/contracts').AccountRepository;
  memberships: import('@gptrouter/contracts').MembershipRepository;
  connections: import('@gptrouter/contracts').ConnectionRepository;
  routes: import('@gptrouter/contracts').RouteRepository;
  policies: import('@gptrouter/contracts').PolicyRepository;
  tasks: import('@gptrouter/contracts').TaskRepository;
  decisions: import('@gptrouter/contracts').DecisionRepository;
  executions: import('@gptrouter/contracts').ExecutionRepository;
  usage: import('@gptrouter/contracts').UsageRepository;
  audit: import('@gptrouter/contracts').AuditRepository;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function safeMetadata(value: Record<string, unknown>): Record<string, unknown> {
  const sanitized = sanitizeForPublicOutput(value);
  return sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized)
    ? (sanitized as Record<string, unknown>)
    : {};
}

function routeProjection(route: ModelRoute): PublicRouteProjection {
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
      effective_at: route.pricing.effective_at.toISOString(),
      refreshed_at: route.pricing.refreshed_at.toISOString(),
      version: route.pricing.version,
    },
    availability_status: route.availability_status,
    provenance: PRODUCTION_DATA_MODE,
  };
}

function decisionProjection(decision: RoutingDecision): PublicRoutingDecision {
  return {
    decision_id: decision.decision_id,
    task_id: decision.task_id,
    policy_id: decision.policy_id,
    policy_version: decision.policy_version,
    evaluated_routes: [...decision.evaluated_routes],
    admissible_routes: [...decision.admissible_routes],
    selected_route_id: decision.selected_route_id,
    route_snapshot: clone(decision.route_snapshot),
    estimated_cost: decision.estimated_cost,
    rejection_reasons: clone(decision.rejection_reasons),
    decided_at: decision.decided_at.toISOString(),
    parent_decision_id: decision.parent_decision_id ?? null,
    fallback_reason: decision.fallback_reason ?? null,
  };
}

function attemptProjection(attempt: ExecutionAttempt): PublicAttemptProjection {
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

function startOfRange(value: Date, range: 'today' | 'week' | 'month'): Date {
  const result = new Date(value);
  if (range === 'today') result.setHours(0, 0, 0, 0);
  else {
    result.setDate(result.getDate() - (range === 'week' ? 7 : 30));
    result.setHours(0, 0, 0, 0);
  }
  return result;
}

function estimateRouteCost(route: ModelRoute): number {
  return route.pricing.input_cost_per_1k_tokens + route.pricing.output_cost_per_1k_tokens;
}

export function createProductionGPTRouterApplication(
  options: ProductionApplicationOptions
): GPTRouterApplication {
  const clock = options.clock ?? (() => new Date());
  const { repositories } = options;
  const budgetEnforcer = new BudgetEnforcer(repositories.usage);
  const routingEngine = new RoutingEngine({
    checkBudget: (accountId, estimatedCost, policy) =>
      budgetEnforcer.checkBudget(accountId, estimatedCost, policy),
    estimateCost: (route) => estimateRouteCost(route),
    getConnection: (connectionId) => repositories.connections.getConnection(connectionId),
  });

  let auditFailureCount = 0;
  let executor: ExecutionExecutor;
  let verifier: ExecutionVerifier;

  if (options.provider_execution_enabled === true) {
    const registry = new DefaultProviderAdapterRegistry();
    const fetchFn = options.fetch ?? globalThis.fetch;
    const endpoint = (provider: string) => {
      const configured = getTrustedEndpoint(provider);
      if (!configured) throw new Error(`trusted_provider_endpoint_missing:${provider}`);
      return configured;
    };
    const google = endpoint('google');
    const openrouter = endpoint('openrouter');
    const deepseek = endpoint('deepseek');
    registry.registerAdapter(
      'google',
      new GeminiAdapter({
        baseUrl: google.baseUrl,
        fetch: fetchFn,
        credentialResolver: options.credentialResolver,
      })
    );
    registry.registerAdapter(
      'openrouter',
      new OpenAICompatibleAdapter({
        provider: 'openrouter',
        baseUrl: openrouter.baseUrl,
        fetch: fetchFn,
        credentialResolver: options.credentialResolver,
      })
    );
    registry.registerAdapter(
      'deepseek',
      new OpenAICompatibleAdapter({
        provider: 'deepseek',
        baseUrl: deepseek.baseUrl,
        fetch: fetchFn,
        credentialResolver: options.credentialResolver,
      })
    );
    const dispatcher = options.gatewayDispatcher ?? new SafeGatewayDispatcher();
    for (const gatewayType of ['openrouter', '9router']) {
      registry.registerAdapter(
        gatewayType,
        new GatewayProviderAdapter({
          gatewayType,
          connections: repositories.connections,
          credentialResolver: options.credentialResolver,
          dispatcher,
        }),
        'gateway'
      );
    }
    executor = new AdapterExecutionCoordinatorBridge({
      registry,
      credentialResolver: options.credentialResolver,
    });
    verifier = new AdapterExecutionVerifier();
  } else {
    executor = new SyntheticExecutor();
    verifier = new DeterministicVerifier();
  }

  const authorization = new AccountAuthorizationService({
    accounts: repositories.accounts,
    memberships: repositories.memberships,
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
  const coordinator = new ExecutionCoordinator({
    repositories: {
      tasks: repositories.tasks,
      decisions: repositories.decisions,
      policies: repositories.policies,
      executions: repositories.executions,
      usage: repositories.usage,
      audit: repositories.audit,
    },
    budgetEnforcer,
    executor,
    verifier,
    fallbackPlanner,
    clock,
    onAuditFailure: () => {
      auditFailureCount += 1;
    },
  });

  function contextRequired(
    context: AuthorizedExecutionContext | undefined
  ): AuthorizedExecutionContext {
    if (!context) throw new AuthorizationError();
    return context;
  }

  async function listAccountDecisions(accountId: string): Promise<RoutingDecision[]> {
    const tasks = await repositories.tasks.listTasks(accountId);
    const grouped = await Promise.all(
      tasks.map((task) => repositories.decisions.listDecisionsForTask(task.task_id))
    );
    return grouped.flat();
  }

  async function listAccountAttempts(accountId: string): Promise<ExecutionAttempt[]> {
    const tasks = await repositories.tasks.listTasks(accountId);
    const grouped = await Promise.all(
      tasks.map((task) => repositories.executions.listAttemptsForTask(task.task_id))
    );
    return grouped.flat();
  }

  async function taskProjection(task: Task, accountId: string): Promise<TaskProjection> {
    const decisions = await repositories.decisions.listDecisionsForTask(task.task_id);
    const attempts = await repositories.executions.listAttemptsForTask(task.task_id);
    const usage = (await repositories.usage.listUsageForAccount(accountId)).filter((record) =>
      attempts.some((attempt) => attempt.attempt_id === record.attempt_id)
    );
    const latestDecision = decisions.at(-1) ?? null;
    const latestAttempt = attempts.at(-1) ?? null;
    const knownActualCost = usage.reduce((sum, record) => sum + (record.actual_cost ?? 0), 0);
    const unknownCostAttemptCount = usage.filter((record) => record.actual_cost === null).length;
    const estimatedCost = latestDecision?.estimated_cost ?? null;
    const estimatedTotal = decisions.reduce(
      (sum, decision) => sum + (decision.estimated_cost ?? 0),
      0
    );
    return {
      task: {
        task_id: task.task_id,
        account_id: task.account_id,
        description: task.description,
        requirements: clone(task.requirements),
        status: task.status,
        created_at: task.created_at.toISOString(),
      },
      routing_decisions: decisions.map(decisionProjection),
      decision_tree: decisions.map((decision) => ({
        decision_id: decision.decision_id,
        parent_decision_id: decision.parent_decision_id ?? null,
        fallback_reason: decision.fallback_reason ?? null,
        selected_route_id: decision.selected_route_id,
        estimated_cost: decision.estimated_cost,
        decided_at: decision.decided_at.toISOString(),
      })),
      latest_decision: latestDecision ? decisionProjection(latestDecision) : null,
      attempts: attempts.map(attemptProjection),
      attempt_tree: attempts.map((attempt) => ({
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
      })),
      latest_attempt: latestAttempt ? attemptProjection(latestAttempt) : null,
      execution_id: latestAttempt?.execution_id ?? null,
      retry_count: attempts.reduce((sum, attempt) => sum + attempt.retry_count, 0),
      fallback_count: decisions.filter((decision) => decision.parent_decision_id).length,
      audit_degraded: auditFailureCount > 0,
      actual_cost: knownActualCost,
      known_actual_cost: knownActualCost,
      unknown_cost_attempt_count: unknownCostAttemptCount,
      cost_complete: unknownCostAttemptCount === 0,
      estimated_cost: estimatedCost,
      cost_variance:
        unknownCostAttemptCount > 0 || estimatedCost === null
          ? null
          : knownActualCost - estimatedTotal,
      execution_status: latestAttempt?.status ?? 'not_started',
      verification_outcome: latestAttempt?.verification_outcome ?? null,
      cancellation_status:
        latestAttempt?.status === 'cancelled'
          ? 'cancelled'
          : latestAttempt?.status === 'cancel_requested'
            ? 'requested'
            : 'not_requested',
      data_mode: PRODUCTION_DATA_MODE,
    };
  }

  const application: GPTRouterApplication = {
    account_id: options.default_account_id ?? 'production',
    async listRoutes(query = {}, context) {
      const account = contextRequired(context);
      const routes = await repositories.routes.listRoutes(account.account.account_id);
      return routes
        .filter(
          (route) =>
            !query.capability_filter ||
            query.capability_filter.every((capability) => route.capabilities.includes(capability))
        )
        .filter(
          (route) => !query.provider_filter || route.source_provider === query.provider_filter
        )
        .map(routeProjection);
    },
    async planTask(request, context) {
      const account = contextRequired(context);
      const policy = await repositories.policies.getDefaultPolicy(account.account.account_id);
      if (!policy) throw new Error('routing_policy_unavailable');
      const task = await repositories.tasks.createTask({
        task_id: `task_${randomUUID()}`,
        account_id: account.account.account_id,
        description: request.description,
        requirements: { capabilities: [...request.required_capabilities] },
        status: 'planning',
      });
      const routes = await repositories.routes.listRoutes(account.account.account_id);
      const decision = await routingEngine.planRoute(
        task,
        { ...policy, ordering_strategy: request.ordering_strategy },
        routes
      );
      const saved = await repositories.decisions.createDecision(decision);
      const selectedRoute = saved.selected_route_id
        ? (routes.find((route) => route.route_id === saved.selected_route_id) ?? null)
        : null;
      return {
        task_id: task.task_id,
        decision_id: saved.decision_id,
        status: 'planning',
        description: task.description,
        required_capabilities: [...task.requirements.capabilities],
        ordering_strategy: request.ordering_strategy,
        selected_route: selectedRoute ? routeProjection(selectedRoute) : null,
        estimated_cost: saved.estimated_cost,
        actual_cost: 0,
        data_mode: PRODUCTION_DATA_MODE,
        decided_at: saved.decided_at.toISOString(),
        note: 'Planning only. No provider dispatch occurs.',
      };
    },
    async getTask(task_id, context) {
      const account = contextRequired(context);
      const task = await repositories.tasks.getTask(task_id);
      if (!task || task.account_id !== account.account.account_id) return null;
      return taskProjection(task, account.account.account_id);
    },
    async getUsage(time_range = 'today', context) {
      const account = contextRequired(context);
      const start = startOfRange(clock(), time_range);
      const decisions = (await listAccountDecisions(account.account.account_id)).filter(
        (decision) => decision.decided_at >= start
      );
      const attempts = (await listAccountAttempts(account.account.account_id)).filter(
        (attempt) => attempt.created_at >= start
      );
      const usage = (
        await repositories.usage.listUsageForAccount(account.account.account_id)
      ).filter((record) => record.reconciled_at >= start);
      const knownActualCost = usage.reduce((sum, record) => sum + (record.actual_cost ?? 0), 0);
      const unknownCostAttemptCount = usage.filter((record) => record.actual_cost === null).length;
      return {
        time_range,
        planning_requests: decisions.length,
        execution_requests: attempts.length,
        execution_roots: new Set(attempts.map((attempt) => attempt.execution_id)).size,
        total_attempts: attempts.length,
        successful_executions: attempts.filter((attempt) => attempt.status === 'completed').length,
        failed_attempts: attempts.filter((attempt) => attempt.status === 'failed').length,
        cancelled_attempts: attempts.filter((attempt) => attempt.status === 'cancelled').length,
        actual_cost: knownActualCost,
        known_actual_cost: knownActualCost,
        unknown_cost_attempt_count: unknownCostAttemptCount,
        cost_complete: unknownCostAttemptCount === 0,
        estimated_planned_cost: decisions.reduce(
          (sum, decision) => sum + (decision.estimated_cost ?? 0),
          0
        ),
        actual_usage_records: usage.length,
        cost_variance:
          unknownCostAttemptCount === 0
            ? usage.reduce((sum, record) => sum + (record.cost_variance ?? 0), 0)
            : 0,
        audit_degraded: auditFailureCount > 0,
        data_mode: PRODUCTION_DATA_MODE,
        note: 'Production PostgreSQL runtime. Live provider calls remain feature-gated.',
      };
    },
    async getDashboardSummary(context) {
      const account = contextRequired(context);
      const decisions = await listAccountDecisions(account.account.account_id);
      const attempts = await listAccountAttempts(account.account.account_id);
      const usage = await repositories.usage.listUsageForAccount(account.account.account_id);
      const knownActualCost = usage.reduce((sum, record) => sum + (record.actual_cost ?? 0), 0);
      return {
        data_source: PRODUCTION_DATA_MODE,
        route_count: (await repositories.routes.listRoutes(account.account.account_id)).length,
        task_count: (await repositories.tasks.listTasks(account.account.account_id)).length,
        decision_count: decisions.length,
        execution_count: new Set(attempts.map((attempt) => attempt.execution_id)).size,
        successful_execution_count: attempts.filter((attempt) => attempt.status === 'completed')
          .length,
        failed_attempt_count: attempts.filter((attempt) => attempt.status === 'failed').length,
        cancelled_attempt_count: attempts.filter((attempt) => attempt.status === 'cancelled')
          .length,
        actual_spend: knownActualCost,
        estimated_planned_cost: decisions.reduce(
          (sum, decision) => sum + (decision.estimated_cost ?? 0),
          0
        ),
        retry_count: attempts.reduce((sum, attempt) => sum + attempt.retry_count, 0),
        fallback_count: decisions.filter((decision) => decision.parent_decision_id).length,
        audit_degraded: auditFailureCount > 0,
        audit_failure_count: auditFailureCount,
        synthetic_execution_enabled: options.provider_execution_enabled !== true,
        provider_execution_enabled: options.provider_execution_enabled === true,
        paid_calls_enabled: options.provider_execution_enabled === true,
      };
    },
    async runTask(request, context) {
      return coordinator.runTask(contextRequired(context), request);
    },
    async cancelExecution(attempt_id, context) {
      return coordinator.cancelExecution(contextRequired(context), attempt_id);
    },
    async authorizeVerifiedIdentity(
      identity: VerifiedExecutionIdentity,
      minimumRole: AccountMembership['role'] = 'member'
    ) {
      const principal = await repositories.principals.getPrincipalBySubject(
        identity.issuer,
        identity.subject
      );
      if (!principal) throw new AuthorizationError();
      return authorization.authorize(principal, identity.account_id, minimumRole);
    },
    async getAuditEvents(context, limit = 50, offset = 0, event_type) {
      const account = contextRequired(context);
      const result = await repositories.audit.listEvents(account.account.account_id, {
        limit,
        offset,
        event_type,
      });
      return result.events.map((event): PublicAuditEvent => ({
        event_id: event.event_id,
        event_type: event.event_type,
        actor: event.actor,
        resource_type: event.resource_type,
        resource_id: event.resource_id,
        metadata: safeMetadata(event.metadata),
        timestamp: event.timestamp.toISOString(),
      }));
    },
    getAuditStatus() {
      return { audit_degraded: auditFailureCount > 0, audit_failure_count: auditFailureCount };
    },
    getSyntheticAuthorizedContext() {
      throw new AuthorizationError();
    },
  };
  return application;
}
