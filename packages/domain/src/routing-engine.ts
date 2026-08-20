/**
 * Core routing algorithm: two-stage admissibility filter + ordering
 *
 * Stage 1: Filter routes by capability, availability, policy, budget
 * Stage 2: Order admissible routes by configured strategy (cost/quality/latency)
 *
 * V0.1: Only cost ordering is operational. Quality/latency require evidence-backed metrics.
 */

import type {
  Task,
  ModelRoute,
  RoutingPolicy,
  RoutingDecision,
  RouteSnapshot,
  RejectionReason,
  RejectionReasonCode,
  BudgetCheckResult,
  RoutePerformanceMetadata,
  Connection,
} from '@gptrouter/contracts';
import { generateId } from './utils.js';

export interface RoutingEngineDependencies {
  checkBudget: (
    account_id: string,
    estimated_cost: number,
    policy: RoutingPolicy
  ) => Promise<BudgetCheckResult>;
  estimateCost: (route: ModelRoute, task: Task) => number;
  getPerformanceMetadata?: (route_id: string) => Promise<RoutePerformanceMetadata | null>;
  /**
   * Resolve persisted provider/gateway metadata by opaque connection ID.
   * Required only for policies whose admissibility depends on connection-owned data.
   */
  getConnection?: (connection_id: string) => Promise<Connection | null>;
}

export class RoutingEngine {
  constructor(private deps: RoutingEngineDependencies) {}

  /**
   * Plan a route for a task. DOES NOT execute or spend money.
   */
  async planRoute(
    task: Task,
    policy: RoutingPolicy,
    availableRoutes: ModelRoute[]
  ): Promise<RoutingDecision> {
    const admissibilityResults = await this.evaluateAdmissibility(availableRoutes, task, policy);
    const admissibleRoutes = admissibilityResults.filter((r) => r.admissible).map((r) => r.route);
    const orderedRoutes = await this.orderRoutes(admissibleRoutes, policy, task);

    const orderingUnsupported =
      admissibleRoutes.length > 0 &&
      orderedRoutes.length === 0 &&
      ['quality', 'latency', 'custom'].includes(policy.ordering_strategy);

    const selectedRoute = orderedRoutes[0] || null;
    const rejectionReasons: RejectionReason[] = admissibilityResults
      .filter((r) => !r.admissible)
      .map((r) => ({
        route_id: r.route.route_id,
        reason_code: r.reason_code!,
        details: r.details!,
      }));

    return {
      decision_id: generateId(),
      task_id: task.task_id,
      policy_id: policy.policy_id,
      policy_version: policy.version,
      evaluated_routes: availableRoutes.map((r) => r.route_id),
      admissible_routes: admissibleRoutes.map((r) => r.route_id),
      selected_route_id: selectedRoute?.route_id || null,
      route_snapshot: selectedRoute ? this.snapshotRoute(selectedRoute, policy.version) : null,
      rejection_reasons: rejectionReasons,
      estimated_cost: selectedRoute ? this.deps.estimateCost(selectedRoute, task) : null,
      decided_at: new Date(),
      ordering_strategy_unsupported: orderingUnsupported || undefined,
    };
  }

  /** Validate a manual route override against the same admissibility criteria. */
  async validateManualOverride(
    route: ModelRoute,
    task: Task,
    policy: RoutingPolicy
  ): Promise<{ valid: boolean; reason?: string }> {
    if (!policy.manual_override_allowed) {
      return { valid: false, reason: 'Manual override not allowed by policy' };
    }

    const [result] = await this.evaluateAdmissibility([route], task, policy);
    if (!result.admissible) return { valid: false, reason: result.details };
    return { valid: true };
  }

  private async evaluateAdmissibility(
    routes: ModelRoute[],
    task: Task,
    policy: RoutingPolicy
  ): Promise<
    Array<{
      route: ModelRoute;
      admissible: boolean;
      reason_code?: RejectionReasonCode;
      details?: string;
    }>
  > {
    return await Promise.all(
      routes.map(async (route) => {
        if (!this.hasRequiredCapabilities(route, task.requirements.capabilities)) {
          return {
            route,
            admissible: false,
            reason_code: 'insufficient_capability' as const,
            details: `Route lacks required capabilities: ${task.requirements.capabilities.join(', ')}`,
          };
        }

        if (route.availability_status !== 'available') {
          return {
            route,
            admissible: false,
            reason_code: 'unavailable' as const,
            details: `Route is ${route.availability_status}`,
          };
        }

        const policyCheck = await this.satisfiesPolicy(route, policy, task.account_id);
        if (!policyCheck.satisfied) {
          return {
            route,
            admissible: false,
            reason_code: policyCheck.reason_code!,
            details: policyCheck.reason!,
          };
        }

        const estimatedCost = this.deps.estimateCost(route, task);
        const budgetCheck = await this.deps.checkBudget(task.account_id, estimatedCost, policy);
        if (!budgetCheck.allowed) {
          return {
            route,
            admissible: false,
            reason_code: this.getBudgetRejectionCode(budgetCheck),
            details: budgetCheck.reason || 'Budget limit exceeded',
          };
        }

        return { route, admissible: true };
      })
    );
  }

  private hasRequiredCapabilities(route: ModelRoute, required: string[]): boolean {
    return required.every((cap) => route.capabilities.includes(cap));
  }

  private async satisfiesPolicy(
    route: ModelRoute,
    policy: RoutingPolicy,
    accountId: string
  ): Promise<{ satisfied: boolean; reason?: string; reason_code?: RejectionReasonCode }> {
    const rules = policy.admissibility_rules;

    if (rules.allowed_route_types && !rules.allowed_route_types.includes(route.route_type)) {
      return {
        satisfied: false,
        reason_code: 'policy_violation_route_type',
        reason: `Route type ${route.route_type} not in allowed types`,
      };
    }

    if (route.route_type === 'provider' && route.source_provider) {
      if (rules.blocked_providers?.includes(route.source_provider)) {
        return {
          satisfied: false,
          reason_code: 'policy_violation_provider_blocked',
          reason: `Provider ${route.source_provider} is blocked`,
        };
      }
      if (rules.allowed_providers && !rules.allowed_providers.includes(route.source_provider)) {
        return {
          satisfied: false,
          reason_code: 'policy_violation_provider_not_allowed',
          reason: `Provider ${route.source_provider} is not in allowed list`,
        };
      }
    }

    if (route.route_type === 'gateway' && route.source_gateway) {
      if (rules.blocked_gateways?.includes(route.source_gateway)) {
        return {
          satisfied: false,
          reason_code: 'policy_violation_gateway_blocked',
          reason: `Gateway ${route.source_gateway} is blocked`,
        };
      }
      if (rules.allowed_gateways && !rules.allowed_gateways.includes(route.source_gateway)) {
        return {
          satisfied: false,
          reason_code: 'policy_violation_gateway_not_allowed',
          reason: `Gateway ${route.source_gateway} is not in allowed list`,
        };
      }
    }

    if (rules.required_capabilities) {
      const missing = rules.required_capabilities.filter(
        (cap: string) => !route.capabilities.includes(cap)
      );
      if (missing.length > 0) {
        return {
          satisfied: false,
          reason_code: 'insufficient_capability',
          reason: `Route missing required policy capabilities: ${missing.join(', ')}`,
        };
      }
    }

    if (rules.excluded_capabilities) {
      const hasExcluded = rules.excluded_capabilities.some((cap: string) =>
        route.capabilities.includes(cap)
      );
      if (hasExcluded) {
        return {
          satisfied: false,
          reason_code: 'policy_violation_excluded_capability',
          reason: 'Route has excluded capabilities',
        };
      }
    }

    if (route.route_type === 'gateway' && rules.require_https) {
      const connectionCheck = await this.validateGatewayConnectionForHttps(route, accountId);
      if (!connectionCheck.satisfied) return connectionCheck;
    }

    return { satisfied: true };
  }

  private async validateGatewayConnectionForHttps(
    route: ModelRoute,
    accountId: string
  ): Promise<{ satisfied: boolean; reason?: string; reason_code?: RejectionReasonCode }> {
    if (!this.deps.getConnection) {
      return this.securityRejection('Gateway connection metadata resolver is unavailable');
    }

    const connection = await this.deps.getConnection(route.connection_id);
    if (!connection) return this.securityRejection('Gateway connection metadata is missing');
    if (connection.type !== 'gateway') {
      return this.securityRejection('Route connection is not a gateway connection');
    }
    if (connection.account_id !== accountId) {
      return this.securityRejection('Gateway connection does not belong to the task account');
    }
    if (connection.status !== 'active') {
      return this.securityRejection(`Gateway connection is ${connection.status}`);
    }

    let gatewayUrl: URL;
    try {
      gatewayUrl = new URL(connection.gateway_url);
    } catch {
      return this.securityRejection('Gateway URL is invalid');
    }

    if (gatewayUrl.protocol !== 'https:') return this.securityRejection('Gateway URL must use HTTPS');
    if (gatewayUrl.username || gatewayUrl.password) {
      return this.securityRejection('Gateway URL must not contain credentials');
    }

    return { satisfied: true };
  }

  private securityRejection(reason: string): {
    satisfied: false;
    reason: string;
    reason_code: RejectionReasonCode;
  } {
    return {
      satisfied: false,
      reason_code: 'policy_violation_security',
      reason,
    };
  }

  private getBudgetRejectionCode(budgetCheck: BudgetCheckResult): RejectionReasonCode {
    const reason = budgetCheck.reason?.toLowerCase() || '';
    if (reason.includes('daily')) return 'budget_exceeded_daily';
    if (reason.includes('monthly')) return 'budget_exceeded_monthly';
    if (reason.includes('route class')) return 'budget_exceeded_route_class';
    return 'budget_exceeded_per_task';
  }

  private async orderRoutes(
    routes: ModelRoute[],
    policy: RoutingPolicy,
    task: Task
  ): Promise<ModelRoute[]> {
    const routesCopy = [...routes];

    switch (policy.ordering_strategy) {
      case 'cost':
        return routesCopy.sort(
          (a, b) => this.deps.estimateCost(a, task) - this.deps.estimateCost(b, task)
        );
      case 'quality':
      case 'latency':
      case 'custom':
        return [];
      default:
        return routesCopy;
    }
  }

  private snapshotRoute(route: ModelRoute, policy_version: number): RouteSnapshot {
    return {
      route_id: route.route_id,
      route_type: route.route_type,
      connection_id: route.connection_id,
      source_id: route.source_id,
      source_provider: route.source_provider,
      source_gateway: route.source_gateway,
      pricing: route.pricing,
      policy_version,
    };
  }
}
