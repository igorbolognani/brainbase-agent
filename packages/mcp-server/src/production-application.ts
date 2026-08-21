import type {
  ExecutionRequest,
  ExecutionProjection,
  ExecutionCoordinatorRepositories,
} from '@gptrouter/domain';
import {
  ExecutionCoordinator,
  BudgetEnforcer,
  RoutingEngine,
  DefaultProviderAdapterRegistry,
  FakeProviderAdapter,
  AdapterExecutionCoordinatorBridge,
  AdapterExecutionVerifier,
  type CredentialResolver,
  type ExecutionExecutor,
  type ExecutionVerifier,
  type FallbackPlanner,
} from '@gptrouter/domain';
import { AccountAuthorizationService, AuthorizationError } from '@gptrouter/security';
import type {
  AuthorizedExecutionContext,
  Task,
  AccountRepository,
  MembershipRepository,
  ConnectionRepository,
  RouteRepository,
  PolicyRepository,
  UsageRepository,
  PrincipalRepository,
} from '@gptrouter/contracts';

export interface ProductionApplicationOptions {
  repositories: Omit<ExecutionCoordinatorRepositories, 'usage'> & {
    principals: PrincipalRepository;
    accounts: AccountRepository;
    memberships: MembershipRepository;
    connections: ConnectionRepository;
    routes: RouteRepository;
    policies: PolicyRepository;
    usage: UsageRepository;
  };
  credentialResolver: CredentialResolver;
  provider_execution_enabled?: boolean;
  clock?: () => Date;
}

export function createProductionGPTRouterApplication(options: ProductionApplicationOptions): {
  runTask: (
    context: AuthorizedExecutionContext,
    request: ExecutionRequest
  ) => Promise<ExecutionProjection>;
  cancelExecution: (
    context: AuthorizedExecutionContext,
    attempt_id: string
  ) => Promise<ExecutionProjection>;
  authorizeVerifiedIdentity: (identity: {
    issuer: string;
    subject: string;
    account_id: string;
  }) => Promise<AuthorizedExecutionContext>;
  getTask: (task_id: string, context: AuthorizedExecutionContext) => Promise<Task | null>;
} {
  const { repositories, credentialResolver, clock } = options;

  const budgetEnforcer = new BudgetEnforcer(repositories.usage);
  const routingEngine = new RoutingEngine({
    checkBudget: (account_id, estimated_cost, policy) =>
      budgetEnforcer.checkBudget(account_id, estimated_cost, policy),
    estimateCost: (route) =>
      route.pricing.input_cost_per_1k_tokens + route.pricing.output_cost_per_1k_tokens,
    getConnection: (connection_id) => repositories.connections.getConnection(connection_id),
  });

  let executor: ExecutionExecutor;
  let verifier: ExecutionVerifier;

  if (options.provider_execution_enabled) {
    const registry = new DefaultProviderAdapterRegistry();
    executor = new AdapterExecutionCoordinatorBridge({ registry, credentialResolver });
    verifier = new AdapterExecutionVerifier();
  } else {
    const registry = new DefaultProviderAdapterRegistry();
    const fakeAdapter = new FakeProviderAdapter({ provider: 'synthetic' });
    registry.setDefaultAdapter(fakeAdapter);
    executor = new AdapterExecutionCoordinatorBridge({ registry, credentialResolver });
    verifier = new AdapterExecutionVerifier();
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

  const executionCoordinator = new ExecutionCoordinator({
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
  });

  return {
    async runTask(context, request) {
      return executionCoordinator.runTask(context, request);
    },
    async cancelExecution(context, attempt_id) {
      return executionCoordinator.cancelExecution(context, attempt_id);
    },
    async authorizeVerifiedIdentity(identity) {
      const principal = await repositories.principals.getPrincipalBySubject(
        identity.issuer,
        identity.subject
      );
      if (!principal) throw new AuthorizationError();
      return authorization.authorize(principal, identity.account_id);
    },
    async getTask(task_id, context) {
      const task = await repositories.tasks.getTask(task_id);
      if (!task || task.account_id !== context.account.account_id) return null;
      return task;
    },
  };
}
