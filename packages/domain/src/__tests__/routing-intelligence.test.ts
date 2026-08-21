import { describe, it, expect, beforeEach } from 'vitest';
import {
  EvidenceBasedRouter,
  rankByScore,
  explainRoutingDecision,
  type RoutingScore,
} from '../routing-scoring.js';
import { InMemoryModelCatalog, type ModelQualityEvidence } from '../model-catalog.js';
import { BenchmarkIngester, type BenchmarkEntry } from '../benchmark-ingester.js';
import type { ModelRoute, RoutingPolicy } from '@gptrouter/contracts';

function makeRoute(overrides: Partial<ModelRoute> = {}): ModelRoute {
  return {
    route_id: 'route-1',
    route_type: 'provider',
    connection_id: 'conn-1',
    source_id: 'model-1',
    source_provider: 'openai',
    capabilities: ['text'],
    pricing: {
      input_cost_per_1k_tokens: 0.01,
      output_cost_per_1k_tokens: 0.02,
      currency: 'USD',
      units: 'per_1k_tokens',
      source: 'test',
      effective_at: new Date(),
      refreshed_at: new Date(),
      version: 'v1',
    },
    availability_status: 'available',
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

function makePolicy(overrides: Partial<RoutingPolicy> = {}): RoutingPolicy {
  return {
    policy_id: 'pol-1',
    account_id: 'acc-1',
    name: 'Default',
    ordering_strategy: 'cost',
    admissibility_rules: {},
    budget_constraints: {},
    manual_override_allowed: false,
    version: 1,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

// ============================================================================
// Evidence-Based Router
// ============================================================================

describe('EvidenceBasedRouter', () => {
  let router: EvidenceBasedRouter;

  beforeEach(() => {
    router = new EvidenceBasedRouter();
  });

  describe('cost strategy', () => {
    it('ranks cheaper routes higher', () => {
      const route1 = makeRoute({
        route_id: 'r1',
        pricing: {
          ...makeRoute().pricing,
          input_cost_per_1k_tokens: 0.05,
          output_cost_per_1k_tokens: 0.1,
        },
      });
      const route2 = makeRoute({
        route_id: 'r2',
        pricing: {
          ...makeRoute().pricing,
          input_cost_per_1k_tokens: 0.01,
          output_cost_per_1k_tokens: 0.02,
        },
      });

      const scores = router.scoreRoutes(
        [route1, route2],
        makePolicy({ ordering_strategy: 'cost' }),
        new Map(),
        new Map()
      );

      expect(scores).not.toBeNull();
      const ranked = rankByScore(scores!);
      expect(ranked[0].route_id).toBe('r2');
      expect(ranked[1].route_id).toBe('r1');
    });

    it('penalizes degraded health', () => {
      const route1 = makeRoute({ route_id: 'r1', connection_id: 'c1' });
      const route2 = makeRoute({ route_id: 'r2', connection_id: 'c2' });
      const healthStates = new Map([['c2', 'degraded'] as const]);

      const scores = router.scoreRoutes(
        [route1, route2],
        makePolicy({ ordering_strategy: 'cost' }),
        new Map(),
        healthStates
      );

      expect(scores).not.toBeNull();
      const r2 = scores!.find((s) => s.route_id === 'r2')!;
      expect(r2.health_penalty).toBeGreaterThan(0);
      expect(r2.reasons).toContain('health_degraded');
    });

    it('blocks unavailable providers', () => {
      const route = makeRoute({ route_id: 'r1', connection_id: 'c1' });
      const healthStates = new Map([['c1', 'unavailable'] as const]);

      const scores = router.scoreRoutes(
        [route],
        makePolicy({ ordering_strategy: 'cost' }),
        new Map(),
        healthStates
      );

      expect(scores).not.toBeNull();
      const r1 = scores![0];
      expect(r1.health_penalty).toBe(1.0);
      expect(r1.total_score).toBeLessThan(0);
    });
  });

  describe('quality strategy', () => {
    it('ranks higher quality routes higher', () => {
      const route1 = makeRoute({ route_id: 'r1' });
      const route2 = makeRoute({ route_id: 'r2' });
      const qualityScores = new Map([
        ['r1', 0.3],
        ['r2', 0.8],
      ]);

      const scores = router.scoreRoutes(
        [route1, route2],
        makePolicy({ ordering_strategy: 'quality' }),
        qualityScores,
        new Map()
      );

      expect(scores).not.toBeNull();
      const ranked = rankByScore(scores!);
      expect(ranked[0].route_id).toBe('r2');
    });

    it('fails closed when no quality evidence exists', () => {
      const route = makeRoute();
      const scores = router.scoreRoutes(
        [route],
        makePolicy({ ordering_strategy: 'quality' }),
        new Map(),
        new Map()
      );

      expect(scores).toBeNull();
    });
  });

  describe('balanced strategy', () => {
    it('combines cost and quality', () => {
      const route1 = makeRoute({
        route_id: 'r1',
        pricing: {
          ...makeRoute().pricing,
          input_cost_per_1k_tokens: 0.01,
          output_cost_per_1k_tokens: 0.01,
        },
      });
      const route2 = makeRoute({
        route_id: 'r2',
        pricing: {
          ...makeRoute().pricing,
          input_cost_per_1k_tokens: 0.1,
          output_cost_per_1k_tokens: 0.1,
        },
      });
      const qualityScores = new Map([
        ['r1', 0.3],
        ['r2', 0.9],
      ]);

      const scores = router.scoreRoutes(
        [route1, route2],
        makePolicy({ ordering_strategy: 'balanced' }),
        qualityScores,
        new Map()
      );

      expect(scores).not.toBeNull();
      expect(scores!.every((s) => s.cost_score > 0 || s.quality_score > 0)).toBe(true);
    });
  });

  describe('unsupported strategies', () => {
    it('returns null for latency strategy', () => {
      const scores = router.scoreRoutes(
        [makeRoute()],
        makePolicy({ ordering_strategy: 'latency' }),
        new Map(),
        new Map()
      );
      expect(scores).toBeNull();
    });

    it('returns null for custom strategy', () => {
      const scores = router.scoreRoutes(
        [makeRoute()],
        makePolicy({ ordering_strategy: 'custom' }),
        new Map(),
        new Map()
      );
      expect(scores).toBeNull();
    });
  });
});

describe('rankByScore', () => {
  it('sorts by total score descending', () => {
    const scores: RoutingScore[] = [
      {
        route_id: 'r1',
        total_score: 0.3,
        cost_score: 0.3,
        quality_score: 0,
        health_penalty: 0,
        reasons: [],
      },
      {
        route_id: 'r2',
        total_score: 0.8,
        cost_score: 0.8,
        quality_score: 0,
        health_penalty: 0,
        reasons: [],
      },
      {
        route_id: 'r3',
        total_score: 0.5,
        cost_score: 0.5,
        quality_score: 0,
        health_penalty: 0,
        reasons: [],
      },
    ];

    const ranked = rankByScore(scores);
    expect(ranked.map((s) => s.route_id)).toEqual(['r2', 'r3', 'r1']);
  });
});

describe('explainRoutingDecision', () => {
  it('generates explanations for rejected routes', () => {
    const scores: RoutingScore[] = [
      {
        route_id: 'r1',
        total_score: 0.5,
        cost_score: 0.5,
        quality_score: 0,
        health_penalty: 0,
        reasons: [],
      },
      {
        route_id: 'r2',
        total_score: 0.3,
        cost_score: 0.3,
        quality_score: 0,
        health_penalty: 0.2,
        reasons: ['health_degraded'],
      },
    ];

    const explanations = explainRoutingDecision(scores);
    expect(explanations).toContain('r2: health_degraded');
    expect(explanations.length).toBe(1);
  });
});

// ============================================================================
// Model Catalog
// ============================================================================

describe('InMemoryModelCatalog', () => {
  let catalog: InMemoryModelCatalog;
  const now = new Date('2025-01-01T00:00:00Z');

  beforeEach(() => {
    catalog = new InMemoryModelCatalog({ clock: () => now });
  });

  it('adds and retrieves offerings', () => {
    catalog.addOffering({
      offering_id: 'offering-1',
      provider: 'openai',
      model_id: 'gpt-4o',
      display_name: 'GPT-4o',
      capabilities: ['text', 'vision'],
      context_window: 128000,
      max_output_tokens: 16384,
      supports_tools: true,
      supports_vision: true,
      supports_audio: false,
      pricing: {
        input_cost_per_1k_tokens: 0.0025,
        output_cost_per_1k_tokens: 0.01,
        currency: 'USD',
        units: 'per_1k_tokens',
        source: 'openai-api',
        effective_at: now,
        refreshed_at: now,
        version: 'v1',
      },
      availability_status: 'available',
      health_state: 'healthy',
      version: 'v1',
    });

    const offering = catalog.getOffering('offering-1');
    expect(offering).toBeDefined();
    expect(offering!.model_id).toBe('gpt-4o');
    expect(offering!.supports_vision).toBe(true);
  });

  it('filters by provider and capability', () => {
    catalog.addOffering({
      offering_id: 'offering-1',
      provider: 'openai',
      model_id: 'gpt-4o',
      display_name: 'GPT-4o',
      capabilities: ['text', 'vision'],
      context_window: 128000,
      max_output_tokens: 16384,
      supports_tools: true,
      supports_vision: true,
      supports_audio: false,
      pricing: {
        input_cost_per_1k_tokens: 0.0025,
        output_cost_per_1k_tokens: 0.01,
        currency: 'USD',
        units: 'per_1k_tokens',
        source: 'test',
        effective_at: now,
        refreshed_at: now,
        version: 'v1',
      },
      availability_status: 'available',
      health_state: 'healthy',
      version: 'v1',
    });
    catalog.addOffering({
      offering_id: 'offering-2',
      provider: 'anthropic',
      model_id: 'claude-3',
      display_name: 'Claude 3',
      capabilities: ['text'],
      context_window: 200000,
      max_output_tokens: 8192,
      supports_tools: true,
      supports_vision: false,
      supports_audio: false,
      pricing: {
        input_cost_per_1k_tokens: 0.015,
        output_cost_per_1k_tokens: 0.075,
        currency: 'USD',
        units: 'per_1k_tokens',
        source: 'test',
        effective_at: now,
        refreshed_at: now,
        version: 'v1',
      },
      availability_status: 'available',
      health_state: 'healthy',
      version: 'v1',
    });

    const openaiModels = catalog.listOfferings({ provider: 'openai' });
    expect(openaiModels).toHaveLength(1);
    expect(openaiModels[0].provider).toBe('openai');

    const visionModels = catalog.listOfferings({ capability: 'vision' });
    expect(visionModels).toHaveLength(1);
    expect(visionModels[0].model_id).toBe('gpt-4o');
  });

  it('tracks quality evidence and computes weighted score', () => {
    catalog.addQualityEvidence({
      evidence_id: 'ev-1',
      model_id: 'gpt-4o',
      provider: 'openai',
      benchmark: 'lm-eval',
      domain: 'general',
      score: 0.85,
      sample_size: 100,
      source: 'open-source-eval',
      confidence: 0.9,
      version: 'v1',
    });
    catalog.addQualityEvidence({
      evidence_id: 'ev-2',
      model_id: 'gpt-4o',
      provider: 'openai',
      benchmark: 'mmlu',
      domain: 'academic',
      score: 0.92,
      sample_size: 50,
      source: 'paper',
      confidence: 0.7,
      version: 'v1',
    });

    const score = catalog.getBestQualityScore('openai', 'gpt-4o');
    expect(score).not.toBeNull();
    // Weighted: (0.85*0.9 + 0.92*0.7) / (0.9 + 0.7) = (0.765 + 0.644) / 1.6 = 0.880625
    expect(score!).toBeCloseTo(0.880625, 4);
  });

  it('returns null quality score for unknown model', () => {
    expect(catalog.getBestQualityScore('unknown', 'model')).toBeNull();
  });
});

// ============================================================================
// Benchmark Ingester
// ============================================================================

describe('BenchmarkIngester', () => {
  let ingester: BenchmarkIngester;
  let imported: ModelQualityEvidence[];

  beforeEach(() => {
    ingester = new BenchmarkIngester();
    imported = [];
  });

  function importFn(evidence: Omit<ModelQualityEvidence, 'effective_at'>): void {
    imported.push({ ...evidence, effective_at: new Date() });
  }

  it('accepts valid entries', () => {
    const entries: BenchmarkEntry[] = [
      {
        model_id: 'gpt-4o',
        provider: 'openai',
        benchmark: 'mmlu',
        domain: 'academic',
        score: 0.88,
        sample_size: 100,
        source: 'paper',
        confidence: 0.9,
        version: 'v1',
      },
    ];

    const result = ingester.ingest(entries, importFn);
    expect(result.accepted).toBe(1);
    expect(result.rejected).toBe(0);
    expect(imported).toHaveLength(1);
  });

  it('rejects malformed entries', () => {
    const entries: BenchmarkEntry[] = [
      {
        model_id: '',
        provider: 'openai',
        benchmark: 'mmlu',
        domain: 'test',
        score: 0.8,
        sample_size: 10,
        source: 'test',
        confidence: 0.9,
        version: 'v1',
      },
      {
        model_id: 'gpt-4o',
        provider: 'openai',
        benchmark: 'mmlu',
        domain: 'test',
        score: 1.5,
        sample_size: 10,
        source: 'test',
        confidence: 0.9,
        version: 'v1',
      },
      {
        model_id: 'gpt-4o',
        provider: 'openai',
        benchmark: 'mmlu',
        domain: 'test',
        score: 0.8,
        sample_size: -1,
        source: 'test',
        confidence: 0.9,
        version: 'v1',
      },
      {
        model_id: 'gpt-4o',
        provider: 'openai',
        benchmark: 'mmlu',
        domain: 'test',
        score: 0.8,
        sample_size: 10,
        source: 'test',
        confidence: 1.5,
        version: 'v1',
      },
    ];

    const result = ingester.ingest(entries, importFn);
    expect(result.accepted).toBe(0);
    expect(result.rejected).toBe(4);
    expect(result.errors).toHaveLength(4);
    expect(imported).toHaveLength(0);
  });

  it('accepts valid and rejects invalid in mixed batch', () => {
    const entries: BenchmarkEntry[] = [
      {
        model_id: 'gpt-4o',
        provider: 'openai',
        benchmark: 'mmlu',
        domain: 'test',
        score: 0.8,
        sample_size: 10,
        source: 'test',
        confidence: 0.9,
        version: 'v1',
      },
      {
        model_id: '',
        provider: 'openai',
        benchmark: 'mmlu',
        domain: 'test',
        score: 0.8,
        sample_size: 10,
        source: 'test',
        confidence: 0.9,
        version: 'v1',
      },
      {
        model_id: 'claude-3',
        provider: 'anthropic',
        benchmark: 'lm-eval',
        domain: 'general',
        score: 0.9,
        sample_size: 50,
        source: 'paper',
        confidence: 0.8,
        version: 'v1',
      },
    ];

    const result = ingester.ingest(entries, importFn);
    expect(result.accepted).toBe(2);
    expect(result.rejected).toBe(1);
    expect(imported).toHaveLength(2);
  });
});
