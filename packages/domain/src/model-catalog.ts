/**
 * Model Catalog: durable model offering representation.
 * A model offering describes provider + model identity, capabilities,
 * pricing, health, and evidence-based quality metadata.
 *
 * Provider + model identity matters. A marketing model name is NOT globally unique.
 */

import type { ModelMetadata, AvailabilityStatus, PricingInfo } from '@gptrouter/contracts';

export interface ModelOffering {
  offering_id: string;
  provider: string;
  model_id: string;
  display_name: string;
  capabilities: string[];
  context_window: number | null;
  max_output_tokens: number | null;
  supports_tools: boolean;
  supports_vision: boolean;
  supports_audio: boolean;
  pricing: PricingInfo;
  availability_status: AvailabilityStatus;
  health_state: 'healthy' | 'degraded' | 'unavailable';
  effective_at: Date;
  refreshed_at: Date;
  version: string;
}

export interface ModelQualityEvidence {
  evidence_id: string;
  model_id: string;
  provider: string;
  benchmark: string;
  domain: string;
  score: number; // 0-1
  sample_size: number;
  source: string;
  effective_at: Date;
  confidence: number; // 0-1
  version: string;
}

export interface InMemoryModelCatalogOptions {
  clock?: () => Date;
}

export class InMemoryModelCatalog {
  private readonly offerings = new Map<string, ModelOffering>();
  private readonly qualityEvidence = new Map<string, ModelQualityEvidence[]>();
  private readonly clock: () => Date;
  private metadataVersion = 'v0.1';

  constructor(options: InMemoryModelCatalogOptions = {}) {
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
    health?: 'healthy' | 'degraded' | 'unavailable';
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

  addQualityEvidence(evidence: Omit<ModelQualityEvidence, 'effective_at'>): void {
    const key = `${evidence.provider}/${evidence.model_id}`;
    const existing = this.qualityEvidence.get(key) ?? [];
    existing.push({ ...evidence, effective_at: this.clock() });
    this.qualityEvidence.set(key, existing);
  }

  getQualityEvidence(provider: string, model_id: string): ModelQualityEvidence[] {
    const key = `${provider}/${model_id}`;
    return this.qualityEvidence.get(key) ?? [];
  }

  getBestQualityScore(provider: string, model_id: string): number | null {
    const evidence = this.getQualityEvidence(provider, model_id);
    if (evidence.length === 0) return null;
    // Weighted average by confidence
    let totalWeight = 0;
    let weightedSum = 0;
    for (const e of evidence) {
      totalWeight += e.confidence;
      weightedSum += e.score * e.confidence;
    }
    return totalWeight > 0 ? weightedSum / totalWeight : null;
  }

  importOfferingsFromMetadata(models: ModelMetadata[], provider: string): number {
    let imported = 0;
    for (const model of models) {
      const offering_id = `${provider}/${model.model_id}`;
      if (!this.offerings.has(offering_id)) {
        this.addOffering({
          offering_id,
          provider,
          model_id: model.model_id,
          display_name: model.model_id,
          capabilities: model.capabilities,
          context_window: null,
          max_output_tokens: null,
          supports_tools: model.capabilities.includes('function-calling'),
          supports_vision: model.capabilities.includes('vision'),
          supports_audio: model.capabilities.includes('audio'),
          pricing: model.pricing,
          availability_status: 'available',
          health_state: 'healthy',
          version: model.version,
        });
        imported++;
      }
    }
    return imported;
  }

  setMetadataVersion(version: string): void {
    this.metadataVersion = version;
  }

  getMetadataVersion(): string {
    return this.metadataVersion;
  }
}
