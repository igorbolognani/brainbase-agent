/**
 * Evidence-based routing strategies.
 * Supports cost, quality, latency, and balanced scoring.
 * Only supports a strategy when the required evidence exists.
 * Unsupported strategies fail closed.
 */

import type {
  ModelRoute,
  RoutingPolicy,
  RoutingScore,
  HealthState,
  PricingStatus,
} from '@gptrouter/contracts';

export interface EvidenceBasedRoutingOptions {
  quality_weight?: number;
  cost_weight?: number;
  health_degraded_penalty?: number;
  health_unavailable_penalty?: number;
}

const DEFAULTS = {
  quality_weight: 0.5,
  cost_weight: 0.5,
  health_degraded_penalty: 0.2,
  health_unavailable_penalty: 1.0,
};

export interface StructuredScoringExplanation {
  route_id: string;
  total_score: number;
  cost_score: number;
  quality_score: number;
  health_penalty: number;
  task_family_used: string | null;
  pricing_status: PricingStatus;
  reasons: string[];
}

export class EvidenceBasedRouter {
  private readonly quality_weight: number;
  private readonly cost_weight: number;
  private readonly health_degraded_penalty: number;
  private readonly health_unavailable_penalty: number;

  constructor(options: EvidenceBasedRoutingOptions = {}) {
    this.quality_weight = options.quality_weight ?? DEFAULTS.quality_weight;
    this.cost_weight = options.cost_weight ?? DEFAULTS.cost_weight;
    this.health_degraded_penalty =
      options.health_degraded_penalty ?? DEFAULTS.health_degraded_penalty;
    this.health_unavailable_penalty =
      options.health_unavailable_penalty ?? DEFAULTS.health_unavailable_penalty;
  }

  scoreRoutes(
    routes: ModelRoute[],
    policy: RoutingPolicy,
    qualityScores: Map<string, number>,
    healthStates: Map<string, HealthState>,
    taskFamily?: string
  ): RoutingScore[] | null {
    switch (policy.ordering_strategy) {
      case 'cost':
        return this.scoreByCost(routes, healthStates, policy);
      case 'quality':
        return this.scoreByQuality(routes, qualityScores, healthStates, taskFamily);
      case 'balanced':
        return this.scoreBalanced(routes, qualityScores, healthStates, taskFamily, policy);
      case 'latency':
      case 'custom':
        return null;
      default:
        return null;
    }
  }

  private scoreByCost(
    routes: ModelRoute[],
    healthStates: Map<string, HealthState>,
    policy?: RoutingPolicy
  ): RoutingScore[] | null {
    if (routes.length === 0) return [];

    if (policy && !policy.allow_unknown_pricing) {
      const hasUnknownPricing = routes.some((r) => r.pricing.pricing_status === 'unknown');
      if (hasUnknownPricing) return [];
    }

    const costs = routes.map(
      (r) => r.pricing.input_cost_per_1k_tokens + r.pricing.output_cost_per_1k_tokens
    );
    const maxCost = Math.max(...costs);
    const minCost = Math.min(...costs);

    return routes.map((route, i) => {
      const cost = costs[i];
      const costScore = maxCost > minCost ? 1 - (cost - minCost) / (maxCost - minCost) : 1;
      const healthState = healthStates.get(route.connection_id) ?? 'healthy';
      const healthPenalty = this.getHealthPenalty(healthState);
      const reasons: string[] = [];

      if (healthState === 'degraded') reasons.push('health_degraded');
      if (healthState === 'unavailable') reasons.push('health_unavailable');

      return {
        route_id: route.route_id,
        total_score: costScore - healthPenalty,
        cost_score: costScore,
        quality_score: 0,
        health_penalty: healthPenalty,
        reasons,
      };
    });
  }

  private scoreByQuality(
    routes: ModelRoute[],
    qualityScores: Map<string, number>,
    healthStates: Map<string, HealthState>,
    _taskFamily?: string
  ): RoutingScore[] | null {
    const hasAnyEvidence = routes.some((r) => qualityScores.has(r.route_id));
    if (!hasAnyEvidence) return null;

    return routes.map((route) => {
      const qualityScore = qualityScores.get(route.route_id) ?? 0;
      const healthState = healthStates.get(route.connection_id) ?? 'healthy';
      const healthPenalty = this.getHealthPenalty(healthState);
      const reasons: string[] = [];

      if (!qualityScores.has(route.route_id)) reasons.push('missing_quality_evidence');
      if (healthState === 'degraded') reasons.push('health_degraded');
      if (healthState === 'unavailable') reasons.push('health_unavailable');

      return {
        route_id: route.route_id,
        total_score: qualityScore - healthPenalty,
        cost_score: 0,
        quality_score: qualityScore,
        health_penalty: healthPenalty,
        reasons,
      };
    });
  }

  private scoreBalanced(
    routes: ModelRoute[],
    qualityScores: Map<string, number>,
    healthStates: Map<string, HealthState>,
    _taskFamily?: string,
    policy?: RoutingPolicy
  ): RoutingScore[] | null {
    const hasAnyEvidence = routes.some((r) => qualityScores.has(r.route_id));
    if (!hasAnyEvidence) return null;

    const costScores = this.scoreByCost(routes, healthStates, policy);
    if (!costScores) return null;

    return routes.map((route, i) => {
      const qualityScore = qualityScores.get(route.route_id) ?? 0;
      const costScore = costScores[i]?.cost_score ?? 0;
      const healthState = healthStates.get(route.connection_id) ?? 'healthy';
      const healthPenalty = this.getHealthPenalty(healthState);

      const totalScore =
        costScore * this.cost_weight + qualityScore * this.quality_weight - healthPenalty;

      const reasons: string[] = [];
      if (!qualityScores.has(route.route_id)) reasons.push('missing_quality_evidence');
      if (healthState === 'degraded') reasons.push('health_degraded');

      return {
        route_id: route.route_id,
        total_score: totalScore,
        cost_score: costScore,
        quality_score: qualityScore,
        health_penalty: healthPenalty,
        reasons,
      };
    });
  }

  private getHealthPenalty(state: HealthState): number {
    switch (state) {
      case 'healthy':
        return 0;
      case 'degraded':
        return this.health_degraded_penalty;
      case 'unavailable':
        return this.health_unavailable_penalty;
      case 'disabled':
        return this.health_unavailable_penalty;
    }
  }
}

export function rankByScore(scores: RoutingScore[]): RoutingScore[] {
  return [...scores].sort((a, b) => {
    if (b.total_score !== a.total_score) return b.total_score - a.total_score;
    if (b.cost_score !== a.cost_score) return b.cost_score - a.cost_score;
    return a.route_id.localeCompare(b.route_id);
  });
}

export function explainRoutingDecision(scores: RoutingScore[]): string[] {
  const ranked = rankByScore(scores);
  const reasons: string[] = [];
  for (const score of ranked) {
    if (score.reasons.length > 0) {
      reasons.push(`${score.route_id}: ${score.reasons.join(', ')}`);
    }
  }
  return reasons;
}
