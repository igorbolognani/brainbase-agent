/**
 * Core routing algorithm: two-stage admissibility filter + ordering
 * 
 * Stage 1: Filter routes by capability, availability, policy, budget
 * Stage 2: Order admissible routes by configured strategy (cost/quality/latency)
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
} from '@gptrouter/contracts';
import { generateId } from './utils.js';

export interface RoutingEngineDependencies {
  checkBudget: (
    account_id: string,
    estimated_cost: number,
    policy: RoutingPolicy
  ) => Promise<BudgetCheckResult>;
  estimateCost: (route: ModelRoute, task: Task) => number;
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
    const admissibilityResults = await this.evaluateAdmissibility(
      availableRoutes,
      task,
      policy
    );

    const admissibleRoutes = admissibilityResults
      .filter((r) => r.admissible)
      .map((r) => r.route);

    // Stage 2: Ordering
    const orderedRoutes = this.orderRoutes(admissibleRoutes, policy, task);

    // Select top route (or null if none admissible)
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
      route_snapshot: selectedRoute ? this.snapshotRoute(selectedRoute) : null,
      rejection_reasons: rejectionReasons,
      estimated_cost: selectedRoute ? this.deps.estimateCost(selectedRoute, task) : null,
      decided_at: new Date(),
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
  // Private: Admissibility Filter
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

        // Check policy constraints
        const policyCheck = this.satisfiesPolicy(route, policy);
        if (!policyCheck.satisfied) {
          return {
            route,
            admissible: false,
            reason_code: 'policy_violation' as const,
            details: policyCheck.reason!,
          };
        }

        // Check budget
        const estimatedCost = this.deps.estimateCost(route, task);
        const budgetCheck = await this.deps.checkBudget(
          task.account_id,
          estimatedCost,
          policy
        );
        if (!budgetCheck.allowed) {
          return {
            route,
            admissible: false,
            reason_code: 'budget_exceeded' as const,
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
  ): { satisfied: boolean; reason?: string } {
    const rules = policy.admissibility_rules;

    // Check allowed route types
    if (rules.allowed_route_types && !rules.allowed_route_types.includes(route.route_type)) {
      return {
        satisfied: false,
        reason: `Route type ${route.route_type} not in allowed types`,
      };
    }

    // Check excluded capabilities
    if (rules.excluded_capabilities) {
      const hasExcluded = rules.excluded_capabilities.some((cap) =>
        route.capabilities.includes(cap)
      );
      if (hasExcluded) {
        return {
          satisfied: false,
          reason: 'Route has excluded capabilities',
        };
      }
    }

    return { satisfied: true };
  }

  // ========================================================================
  // Private: Ordering
  // ========================================================================

  private orderRoutes(routes: ModelRoute[], policy: RoutingPolicy, task: Task): ModelRoute[] {
    const routesCopy = [...routes];

    switch (policy.ordering_strategy) {
      case 'cost':
        return routesCopy.sort(
          (a, b) => this.deps.estimateCost(a, task) - this.deps.estimateCost(b, task)
        );

      case 'quality':
        return routesCopy.sort(
          (a, b) => this.qualityScore(b) - this.qualityScore(a) // Higher is better
        );

      case 'latency':
        return routesCopy.sort((a, b) => this.latencyEstimate(a) - this.latencyEstimate(b));

      case 'custom':
        // Custom ordering would use additional policy configuration
        // For now, fall back to cost
        return routesCopy.sort(
          (a, b) => this.deps.estimateCost(a, task) - this.deps.estimateCost(b, task)
        );

      default:
        return routesCopy;
    }
  }

  private qualityScore(route: ModelRoute): number {
    // Simple heuristic: more capabilities = higher quality
    // Real implementation would use model-specific quality metrics
    return route.capabilities.length;
  }

  private latencyEstimate(_route: ModelRoute): number {
    // Placeholder: would use historical latency data
    // For now, assume all routes have similar latency
    return 1000; // ms
  }

  // ========================================================================
  // Private: Utilities
  // ========================================================================

  private snapshotRoute(route: ModelRoute): RouteSnapshot {
    return {
      route_id: route.route_id,
      route_type: route.route_type,
      connection_id: route.connection_id,
      source_id: route.source_id,
      pricing_metadata_version: route.pricing_metadata_version,
      pricing: route.pricing,
    };
  }
}
