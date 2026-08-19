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
    // Stage 1: Admissibility Filter
    const admissibilityResults = await this.evaluateAdmissibility(availableRoutes, task, policy);

    const admissibleRoutes = admissibilityResults.filter((r) => r.admissible).map((r) => r.route);

    // Stage 2: Ordering
    const orderedRoutes = await this.orderRoutes(admissibleRoutes, policy, task);

    // Check if ordering strategy is unsupported (empty result despite admissible routes)
    const orderingUnsupported =
      admissibleRoutes.length > 0 &&
      orderedRoutes.length === 0 &&
      ['quality', 'latency', 'custom'].includes(policy.ordering_strategy);

    // Select top route (or null if none admissible or strategy unsupported)
    const selectedRoute = orderedRoutes[0] || null;

    // Build rejection reasons for non-admissible routes
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

  /**
   * Validate a manual route override against admissibility criteria
   */
  async validateManualOverride(
    route: ModelRoute,
    task: Task,
    policy: RoutingPolicy
  ): Promise<{ valid: boolean; reason?: string }> {
    if (!policy.manual_override_allowed) {
      return { valid: false, reason: 'Manual override not allowed by policy' };
    }

    const results = await this.evaluateAdmissibility([route], task, policy);
    const result = results[0];

    if (!result.admissible) {
      return { valid: false, reason: result.details };
    }

    return { valid: true };
  }

  // ========================================================================
  // Private: Admissibility Filter (ENFORCES ALL POLICY CONSTRAINTS)
  // ========================================================================

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
    const results = await Promise.all(
      routes.map(async (route) => {
        // Check capability match
        if (!this.hasRequiredCapabilities(route, task.requirements.capabilities)) {
          return {
            route,
            admissible: false,
            reason_code: 'insufficient_capability' as const,
            details: `Route lacks required capabilities: ${task.requirements.capabilities.join(', ')}`,
          };
        }

        // Check availability
        if (route.availability_status !== 'available') {
          return {
            route,
            admissible: false,
            reason_code: 'unavailable' as const,
            details: `Route is ${route.availability_status}`,
          };
        }

        // Check ALL policy constraints
        const policyCheck = this.satisfiesPolicy(route, policy);
        if (!policyCheck.satisfied) {
          return {
            route,
            admissible: false,
            reason_code: policyCheck.reason_code!,
            details: policyCheck.reason!,
          };
        }

        // Check budget
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

        // All checks passed
        return { route, admissible: true };
      })
    );

    return results;
  }

  private hasRequiredCapabilities(route: ModelRoute, required: string[]): boolean {
    return required.every((cap) => route.capabilities.includes(cap));
  }

  private satisfiesPolicy(
    route: ModelRoute,
    policy: RoutingPolicy
  ): { satisfied: boolean; reason?: string; reason_code?: RejectionReasonCode } {
    const rules = policy.admissibility_rules;

    // Check allowed route types
    if (rules.allowed_route_types && !rules.allowed_route_types.includes(route.route_type)) {
      return {
        satisfied: false,
        reason_code: 'policy_violation_route_type',
        reason: `Route type ${route.route_type} not in allowed types`,
      };
    }

    // For provider routes: check provider allow/block lists
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

    // For gateway routes: check gateway allow/block lists
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

    // Check required capabilities (already checked in admissibility but policy may have extras)
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

    // Check excluded capabilities
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

    // Security: check HTTPS requirement for gateways
    if (route.route_type === 'gateway' && rules.require_https) {
      // TODO: Implement actual HTTPS enforcement with gateway connection metadata
      // V0.1: Fail closed - reject gateway routes when require_https is enabled
      // until connection metadata integration is complete
      return {
        satisfied: false,
        reason_code: 'policy_violation_security',
        reason: 'HTTPS enforcement requires gateway connection metadata (not yet integrated)',
      };
    }

    return { satisfied: true };
  }

  private getBudgetRejectionCode(budgetCheck: BudgetCheckResult): RejectionReasonCode {
    // Infer reason code from budget check details
    const reason = budgetCheck.reason?.toLowerCase() || '';
    if (reason.includes('daily')) return 'budget_exceeded_daily';
    if (reason.includes('monthly')) return 'budget_exceeded_monthly';
    if (reason.includes('route class')) return 'budget_exceeded_route_class';
    return 'budget_exceeded_per_task';
  }

  // ========================================================================
  // Private: Ordering (V0.1: Only cost is operational)
  // ========================================================================

  private async orderRoutes(
    routes: ModelRoute[],
    policy: RoutingPolicy,
    task: Task
  ): Promise<ModelRoute[]> {
    const routesCopy = [...routes];

    switch (policy.ordering_strategy) {
      case 'cost':
        // Operational: sort by estimated cost (ascending)
        return routesCopy.sort(
          (a, b) => this.deps.estimateCost(a, task) - this.deps.estimateCost(b, task)
        );

      case 'quality':
      case 'latency':
      case 'custom':
        // V0.1: Unsupported strategies - fail closed
        // Do NOT silently execute a different strategy
        // Caller must handle empty result indicating unsupported strategy
        return [];

      default:
        return routesCopy;
    }
  }

  // ========================================================================
  // Private: Utilities
  // ========================================================================

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
