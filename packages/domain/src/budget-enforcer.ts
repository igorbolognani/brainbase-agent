/**
 * Budget enforcement service
 * 
 * Server-side validation of budget constraints before execution.
 */

import type {
  RoutingPolicy,
  BudgetCheckResult,
  UsageRepository,
} from '@gptrouter/contracts';

export class BudgetEnforcer {
  constructor(private usageRepository: UsageRepository) {}

  async checkBudget(
    account_id: string,
    estimated_cost: number,
    policy: RoutingPolicy
  ): Promise<BudgetCheckResult> {
    const constraints = policy.budget_constraints;

    // Check free_only flag
    if (constraints.free_only && estimated_cost > 0) {
      return {
        allowed: false,
        reason: 'free_only policy: only zero-cost routes permitted',
      };
    }

    // Check per-task maximum
    if (constraints.max_cost_per_task !== undefined) {
      if (estimated_cost > constraints.max_cost_per_task) {
        return {
          allowed: false,
          reason: `Estimated cost ${estimated_cost} exceeds max_cost_per_task ${constraints.max_cost_per_task}`,
        };
      }
    }

    // Check daily cap
    if (constraints.daily_cap !== undefined) {
      const dailySpent = await this.usageRepository.getDailySpending(account_id);
      const projectedDaily = dailySpent + estimated_cost;

      if (projectedDaily > constraints.daily_cap) {
        return {
          allowed: false,
          reason: `Projected daily spending ${projectedDaily} exceeds daily cap ${constraints.daily_cap}`,
          remaining_daily: Math.max(0, constraints.daily_cap - dailySpent),
        };
      }
    }

    // Check monthly cap
    if (constraints.monthly_cap !== undefined) {
      const monthlySpent = await this.usageRepository.getMonthlySpending(account_id);
      const projectedMonthly = monthlySpent + estimated_cost;

      if (projectedMonthly > constraints.monthly_cap) {
        return {
          allowed: false,
          reason: `Projected monthly spending ${projectedMonthly} exceeds monthly cap ${constraints.monthly_cap}`,
          remaining_monthly: Math.max(0, constraints.monthly_cap - monthlySpent),
        };
      }
    }

    // All checks passed
    return {
      allowed: true,
      remaining_daily: constraints.daily_cap
        ? constraints.daily_cap - (await this.usageRepository.getDailySpending(account_id))
        : undefined,
      remaining_monthly: constraints.monthly_cap
        ? constraints.monthly_cap - (await this.usageRepository.getMonthlySpending(account_id))
        : undefined,
    };
  }
}
