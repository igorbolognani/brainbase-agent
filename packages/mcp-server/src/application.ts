import type {
  Connection,
  ConnectionRepository,
  DecisionRepository,
  ModelRoute,
  PolicyRepository,
  RouteRepository,
  RoutingDecision,
  RoutingPolicy,
  Task,
  TaskRepository,
  UsageRecord,
  UsageRepository,
} from '@gptrouter/contracts';
import { BudgetEnforcer, RoutingEngine, generateId } from '@gptrouter/domain';

export const SYNTHETIC_ACCOUNT_ID = 'account-synthetic-v0';
export const SYNTHETIC_DATA_MODE = 'synthetic_repository';

export interface ListRoutesQuery {
  capability_filter?: string[];
  provider_filter?: string;
}

export interface PlanTaskRequest {
  description: string;
  required_capabilities: string[];
  ordering_strategy: 'cost';
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
    effective_at: string;
    refreshed_at: string;
    version: string;
  };
  availability_status: ModelRoute['availability_status'];
  provenance: typeof SYNTHETIC_DATA_MODE;
}

export interface PlannedTaskProjection {
  task_id: string;
  decision_id: string;
  status: 'planning';
  description: string;
  required_capabilities: string[];
  ordering_strategy: 'cost';
  selected_route: PublicRouteProjection | null;
  estimated_cost: number | null;
  actual_cost: 0;
  data_mode: typeof SYNTHETIC_DATA_MODE;
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
  latest_decision: {
    decision_id: string;
    selected_route_id: string | null;
    estimated_cost: number | null;
    rejection_reasons: RoutingDecision['rejection_reasons'];
    decided_at: string;
  } | null;
  actual_cost: 0;
  execution_status: 'not_started';
  data_mode: typeof SYNTHETIC_DATA_MODE;
}

export interface UsageProjection {
  time_range: 'today' | 'week' | 'month';
  planning_requests: number;
  execution_requests: 0;
  actual_cost: 0;
  estimated_planned_cost: number;
  actual_usage_records: 0;
  data_mode: typeof SYNTHETIC_DATA_MODE;
  note: string;
}

export interface DashboardRuntimeSummary {
  data_source: typeof SYNTHETIC_DATA_MODE;
  route_count: number;
  task_count: number;
  decision_count: number;
  execution_count: 0;
  actual_spend: 0;
  estimated_planned_cost: number;
}

export interface GPTRouterApplication {
  readonly account_id: string;
  listRoutes(query?: ListRoutesQuery): Promise<PublicRouteProjection[]>;
  planTask(request: PlanTaskRequest): Promise<PlannedTaskProjection>;
  getTask(task_id: string): Promise<TaskProjection | null>;
  getUsage(time_range?: 'today' | 'week' | 'month'): Promise<UsageProjection>;
  getDashboardSummary(): Promise<DashboardRuntimeSummary>;
}

interface SyntheticStore {
  connections: Map<string, Connection>;
  routes: Map<string, ModelRoute>;
  policies: Map<string, RoutingPolicy>;
  tasks: Map<string, Task>;
  decisions: Map<string, RoutingDecision>;
  usage: Map<string, UsageRecord>;
}

interface SyntheticRepositories {
  store: SyntheticStore;
  connections: ConnectionRepository;
  routes: RouteRepository;
  policies: PolicyRepository;
  tasks: TaskRepository;
  decisions: DecisionRepository;
  usage: UsageRepository;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function createSyntheticRepositories(now: Date): SyntheticRepositories {
  const store: SyntheticStore = {
    connections: new Map(),
    routes: new Map(),
    policies: new Map(),
    tasks: new Map(),
    decisions: new Map(),
    usage: new Map(),
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
    async createTask(task) {
      const created: Task = { ...task, created_at: new Date() };
      store.tasks.set(created.task_id, clone(created));
      return clone(created);
    },
    async updateTaskStatus(task_id, status) {
      const task = store.tasks.get(task_id);
      if (!task) return;
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

  const usage: UsageRepository = {
    async getUsage(usage_id) {
      const record = store.usage.get(usage_id);
      return record ? clone(record) : null;
    },
    async getUsageForAttempt(attempt_id) {
      const record = [...store.usage.values()].find((item) => item.attempt_id === attempt_id);
      return record ? clone(record) : null;
    },
    async createUsage(record) {
      const created: UsageRecord = { ...record, reconciled_at: new Date() };
      store.usage.set(created.usage_id, clone(created));
      return clone(created);
    },
    async getDailySpending() {
      return 0;
    },
    async getMonthlySpending() {
      return 0;
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
    manual_override_allowed: true,
    version: 1,
    created_at: now,
    updated_at: now,
  };
  store.policies.set(defaultPolicy.policy_id, clone(defaultPolicy));

  return { store, connections, routes, policies, tasks, decisions, usage };
}

function estimateRouteCost(route: ModelRoute): number {
  return route.pricing.input_cost_per_1k_tokens + route.pricing.output_cost_per_1k_tokens;
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
      effective_at: route.pricing.effective_at.toISOString(),
      refreshed_at: route.pricing.refreshed_at.toISOString(),
      version: route.pricing.version,
    },
    availability_status: route.availability_status,
    provenance: SYNTHETIC_DATA_MODE,
  };
}

export function createSyntheticGPTRouterApplication(): GPTRouterApplication {
  const repositories = createSyntheticRepositories(new Date());
  const budgetEnforcer = new BudgetEnforcer(repositories.usage);
  const routingEngine = new RoutingEngine({
    checkBudget: (account_id, estimated_cost, policy) =>
      budgetEnforcer.checkBudget(account_id, estimated_cost, policy),
    estimateCost: (route) => estimateRouteCost(route),
    getConnection: (connection_id) => repositories.connections.getConnection(connection_id),
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

  return {
    account_id: SYNTHETIC_ACCOUNT_ID,

    async listRoutes(query = {}) {
      const routes = await repositories.routes.listRoutes(SYNTHETIC_ACCOUNT_ID);
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

    async planTask(request) {
      const policy = await repositories.policies.getDefaultPolicy(SYNTHETIC_ACCOUNT_ID);
      if (!policy) throw new Error('Synthetic routing policy is unavailable');

      const task = await repositories.tasks.createTask({
        task_id: `task_${generateId()}`,
        account_id: SYNTHETIC_ACCOUNT_ID,
        description: request.description,
        requirements: { capabilities: [...request.required_capabilities] },
        status: 'planning',
      });
      const routes = await repositories.routes.listRoutes(SYNTHETIC_ACCOUNT_ID);
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

    async getTask(task_id) {
      const task = await repositories.tasks.getTask(task_id);
      if (!task || task.account_id !== SYNTHETIC_ACCOUNT_ID) return null;
      const decisions = await repositories.decisions.listDecisionsForTask(task.task_id);
      const latest = decisions.at(-1) ?? null;
      return {
        task: {
          task_id: task.task_id,
          account_id: task.account_id,
          description: task.description,
          requirements: clone(task.requirements),
          status: task.status,
          created_at: task.created_at.toISOString(),
        },
        latest_decision: latest
          ? {
              decision_id: latest.decision_id,
              selected_route_id: latest.selected_route_id,
              estimated_cost: latest.estimated_cost,
              rejection_reasons: clone(latest.rejection_reasons),
              decided_at: latest.decided_at.toISOString(),
            }
          : null,
        actual_cost: 0,
        execution_status: 'not_started',
        data_mode: SYNTHETIC_DATA_MODE,
      };
    },

    async getUsage(time_range = 'today') {
      const decisions = await decisionsForAccount(SYNTHETIC_ACCOUNT_ID);
      const estimatedPlannedCost = decisions.reduce(
        (sum, decision) => sum + (decision.estimated_cost ?? 0),
        0
      );
      return {
        time_range,
        planning_requests: decisions.length,
        execution_requests: 0,
        actual_cost: 0,
        estimated_planned_cost: estimatedPlannedCost,
        actual_usage_records: 0,
        data_mode: SYNTHETIC_DATA_MODE,
        note: 'Synthetic session state only. Actual provider execution and reconciled spend are disabled.',
      };
    },

    async getDashboardSummary() {
      const decisions = await decisionsForAccount(SYNTHETIC_ACCOUNT_ID);
      const taskCount = [...repositories.store.tasks.values()].filter(
        (task) => task.account_id === SYNTHETIC_ACCOUNT_ID
      ).length;
      const routeCount = (await repositories.routes.listRoutes(SYNTHETIC_ACCOUNT_ID)).length;
      return {
        data_source: SYNTHETIC_DATA_MODE,
        route_count: routeCount,
        task_count: taskCount,
        decision_count: decisions.length,
        execution_count: 0,
        actual_spend: 0,
        estimated_planned_cost: decisions.reduce(
          (sum, decision) => sum + (decision.estimated_cost ?? 0),
          0
        ),
      };
    },
  };
}
