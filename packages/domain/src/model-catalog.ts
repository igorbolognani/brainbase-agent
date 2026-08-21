/**
 * Model Catalog: durable model offering representation and evidence management.
 * A model offering describes provider + model identity, capabilities,
 * pricing, health, and evidence-based quality metadata.
 *
 * Provider + model identity matters. A marketing model name is NOT globally unique.
 */

import type {
  ModelOffering,
  ModelQualityEvidence,
  AvailabilityStatus,
  HealthState,
} from '@gptrouter/contracts';

export interface ModelCatalogOptions {
  clock?: () => Date;
}

export class InMemoryModelCatalog {
  private readonly offerings = new Map<string, ModelOffering>();
  private readonly qualityEvidence = new Map<string, ModelQualityEvidence[]>();
  private readonly clock: () => Date;

  constructor(options: ModelCatalogOptions = {}) {
    this.clock = options.clock ?? (() => new Date());
  }

  addOffering(offering: Omit<ModelOffering, 'effective_at' | 'refreshed_at'>): void {
    const now = this.clock();
    this.offerings.set(offering.offering_id, {
      ...offering,
      effective_at: now,
      refreshed_at: now,
    });
  }

  updateOffering(offering_id: string, updates: Partial<ModelOffering>): void {
    const existing = this.offerings.get(offering_id);
    if (!existing) return;
    this.offerings.set(offering_id, {
      ...existing,
      ...updates,
      refreshed_at: this.clock(),
    });
  }

  removeOffering(offering_id: string): void {
    this.offerings.delete(offering_id);
  }

  getOffering(offering_id: string): ModelOffering | undefined {
    return this.offerings.get(offering_id);
  }

  listOfferings(filters?: {
    provider?: string;
    capability?: string;
    availability?: AvailabilityStatus;
    health?: HealthState;
  }): ModelOffering[] {
    let result = [...this.offerings.values()];
    if (filters?.provider) {
      result = result.filter((o) => o.provider === filters.provider);
    }
    if (filters?.capability) {
      result = result.filter((o) => o.capabilities.includes(filters.capability!));
    }
    if (filters?.availability) {
      result = result.filter((o) => o.availability_status === filters.availability);
    }
    if (filters?.health) {
      result = result.filter((o) => o.health_state === filters.health);
    }
    return result;
  }

  addQualityEvidence(evidence: Omit<ModelQualityEvidence, 'ingested_at'>): void {
    const existing = this.qualityEvidence.get(evidence.offering_id) ?? [];
    existing.push({ ...evidence, ingested_at: this.clock() });
    this.qualityEvidence.set(evidence.offering_id, existing);
  }

  getQualityEvidence(offering_id: string): ModelQualityEvidence[] {
    return this.qualityEvidence.get(offering_id) ?? [];
  }

  getBestQualityScore(offering_id: string): number | null {
    const evidence = this.getQualityEvidence(offering_id);
    if (evidence.length === 0) return null;
    let totalWeight = 0;
    let weightedSum = 0;
    for (const e of evidence) {
      totalWeight += e.confidence;
      weightedSum += (e.higher_is_better ? e.score : 1 - e.score) * e.confidence;
    }
    return totalWeight > 0 ? weightedSum / totalWeight : null;
  }

  getQualityScoreForTask(offering_id: string, taskFamily: string): number | null {
    const evidence = this.getQualityEvidence(offering_id);
    if (evidence.length === 0) return null;
    const relevant = evidence.filter(
      (e) => e.task_family === taskFamily || e.domain === taskFamily
    );
    if (relevant.length === 0) {
      const general = evidence.filter((e) => e.task_family === 'general' || e.domain === 'general');
      if (general.length === 0) return null;
      let totalWeight = 0;
      let weightedSum = 0;
      for (const e of general) {
        totalWeight += e.confidence;
        weightedSum += (e.higher_is_better ? e.score : 1 - e.score) * e.confidence;
      }
      return totalWeight > 0 ? weightedSum / totalWeight : null;
    }
    let totalWeight = 0;
    let weightedSum = 0;
    for (const e of relevant) {
      totalWeight += e.confidence;
      weightedSum += (e.higher_is_better ? e.score : 1 - e.score) * e.confidence;
    }
    return totalWeight > 0 ? weightedSum / totalWeight : null;
  }
}
