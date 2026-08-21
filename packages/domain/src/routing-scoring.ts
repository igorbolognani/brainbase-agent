/**
 * Evidence-based routing strategies.
 * Supports cost, quality, latency, and balanced scoring.
 * Only supports a strategy when the required evidence exists.
 * Unsupported strategies fail closed.
 */

import type { ModelRoute, RoutingPolicy } from '@gptrouter/contracts';

export interface RoutingScore {
  route_id: string;
  total_score: number;
  cost_score: number;
  quality_score: number;
  health_penalty: number;
  reasons: string[];
}

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

export class EvidenceBasedRouter {
  private readonly quality_weight: number;
  private readonly cost_weight: number;
  private readonly health_degraded_penalty: number;
  private readonly health_unavailable_penalty: number;

  constructor(options: EvidenceBasedRoutingOptions = {}) {
    this.quality_weight = options.quality_weight ?? DEFAULTS.quality_weight;
    this.cost_weight = options.cost_weight ?? DEFAULTS.cost_weight;
    this.health_degraded_penalty = options.health_degraded_penalty ?? DEFAULTS.health_degraded_penalty;
    this.health_unavailable_penalty = options.health_unavailable_penalty ?? DEFAULTS.health_unavailable_penalty;
  }

  /**
   * Score routes using the configured strategy.
   * Returns null if the strategy is unsupported (fail closed).
   */
  scoreRoutes(
    routes: ModelRoute[],
    policy: RoutingPolicy,
    qualityScores: Map<string, number>,
    healthStates: Map<string, 'healthy' | 'degraded' | 'unavailable'>
  ): RoutingScore[] | null {
    switch (policy.ordering_strategy) {
      case 'cost':
        return this.scoreByCost(routes, healthStates);
      case 'quality':
        return this.scoreByQuality(routes, qualityScores, healthStates);
      case 'balanced':
        return this.scoreBalanced(routes, qualityScores, healthStates);
      case 'latency':
      case 'custom':
        // Latency and custom require evidence that doesn't exist yet
        return null;
      default:
        return null;
    }
  }

  private scoreByCost(
    routes: ModelRoute[],
    healthStates: Map<string, 'healthy' | 'degraded' | 'unavailable'>
  ): RoutingScore[] {
    if (routes.length === 0) return [];

    const maxCost = Math.max(...routes.map((r) => r.pricing.input_cost_per_1k_tokens + r.pricing.output_cost_per_1k_tokens));

    return routes.map((route) => {
      const cost = route.pricing.input_cost_per_1k_tokens + route.pricing.output_cost_per_1k_tokens;
      const costScore = maxCost > 0 ? 1 - (cost / maxCost) : 1;
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
    healthStates: Map<string, 'healthy' | 'degraded' | 'unavailable'>
  ): RoutingScore[] | null {
    // Fail closed if no quality evidence exists for any route
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
    healthStates: Map<string, 'healthy' | 'degraded' | 'unavailable'>
  ): RoutingScore[] | null {
    // Fail closed if quality evidence is required but missing
    const hasAnyEvidence = routes.some((r) => qualityScores.has(r.route_id));
    if (!hasAnyEvidence) return null;

    const costScores = this.scoreByCost(routes, healthStates);

    return routes.map((route, i) => {
      const qualityScore = qualityScores.get(route.route_id) ?? 0;
      const costScore = costScores[i]?.cost_score ?? 0;
      const healthState = healthStates.get(route.connection_id) ?? 'healthy';
      const healthPenalty = this.getHealthPenalty(healthState);

      const totalScore =
        (costScore * this.cost_weight) +
        (qualityScore * this.quality_weight) -
        healthPenalty;

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

  private getHealthPenalty(state: 'healthy' | 'degraded' | 'unavailable'): number {
    switch (state) {
      case 'healthy': return 0;
      case 'degraded': return this.health_degraded_penalty;
      case 'unavailable': return this.health_unavailable_penalty;
    }
  }
}

export function rankByScore(scores: RoutingScore[]): RoutingScore[] {
  return [...scores].sort((a, b) => b.total_score - a.total_score);
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
