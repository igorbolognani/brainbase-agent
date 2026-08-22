import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryModelCatalog } from '../model-catalog.js';
import { BenchmarkIngester } from '../benchmark-ingester.js';
import { ConnectionHealthTracker } from '../connection-health.js';
import { EvidenceBasedRouter, rankByScore, explainRoutingDecision } from '../routing-scoring.js';
import type { ModelOffering, ModelRoute, RoutingPolicy } from '@gptrouter/contracts';

function makeRoute(overrides: Partial<ModelRoute> = {}): ModelRoute {
  return {
    route_id: `route-${Math.random().toString(36).slice(2, 8)}`,
    route_type: 'provider',
    connection_id: 'conn-1',
    source_id: 'model-1',
    source_provider: 'provider-1',
    capabilities: ['text'],
    pricing: {
      input_cost_per_1k_tokens: 0.01,
      output_cost_per_1k_tokens: 0.02,
      currency: 'USD',
      units: 'per_1k_tokens',
      source: 'test',
      pricing_status: 'known_paid',
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

function makeOffering(
  overrides: Partial<ModelOffering> = {}
): Omit<ModelOffering, 'effective_at' | 'refreshed_at'> {
  return {
    offering_id: 'provider-1/model-1',
    provider: 'provider-1',
    model_id: 'model-1',
    display_name: 'Model 1',
    capabilities: ['text'],
    context_window: 4096,
    max_output_tokens: 2048,
    supports_tools: true,
    supports_vision: false,
    supports_audio: false,
    supports_structured_output: false,
    supports_reasoning: false,
    pricing: {
      input_cost_per_1k_tokens: 0.01,
      output_cost_per_1k_tokens: 0.02,
      currency: 'USD',
      units: 'per_1k_tokens',
      source: 'test',
      pricing_status: 'known_paid',
      effective_at: new Date(),
      refreshed_at: new Date(),
      version: 'v1',
    },
    availability_status: 'available',
    health_state: 'healthy',
    version: 'v1',
    ...overrides,
  };
}

// ============================================================================
// Model Catalog
// ============================================================================

describe('InMemoryModelCatalog', () => {
  let catalog: InMemoryModelCatalog;

  beforeEach(() => {
    catalog = new InMemoryModelCatalog();
  });

  it('adds and retrieves offerings', () => {
    catalog.addOffering(makeOffering());
    const offering = catalog.getOffering('provider-1/model-1');
    expect(offering).toBeDefined();
    expect(offering!.provider).toBe('provider-1');
    expect(offering!.model_id).toBe('model-1');
  });

  it('lists offerings with filters', () => {
    catalog.addOffering(makeOffering({ offering_id: 'p1/m1', provider: 'p1' }));
    catalog.addOffering(
      makeOffering({ offering_id: 'p2/m2', provider: 'p2', capabilities: ['vision'] })
    );

    expect(catalog.listOfferings({ provider: 'p1' })).toHaveLength(1);
    expect(catalog.listOfferings({ capability: 'vision' })).toHaveLength(1);
    expect(catalog.listOfferings()).toHaveLength(2);
  });

  it('updates offering health', () => {
    catalog.addOffering(makeOffering());
    catalog.updateOffering('provider-1/model-1', { health_state: 'degraded' });
    expect(catalog.getOffering('provider-1/model-1')!.health_state).toBe('degraded');
  });

  it('adds and retrieves quality evidence', () => {
    catalog.addOffering(makeOffering());
    catalog.addQualityEvidence({
      evidence_id: 'ev-1',
      offering_id: 'provider-1/model-1',
      evidence_type: 'benchmark',
      benchmark: 'mmlu',
      domain: 'general',
      task_family: 'general',
      score: 0.85,
      score_scale: '0-1',
      higher_is_better: true,
      sample_size: 100,
      source: 'test',
      source_reference: 'https://example.com',
      measured_at: new Date(),
      version: 'v1',
      confidence: 0.9,
    });

    const evidence = catalog.getQualityEvidence('provider-1/model-1');
    expect(evidence).toHaveLength(1);
    expect(evidence[0].benchmark).toBe('mmlu');
  });

  it('computes weighted quality score', () => {
    catalog.addOffering(makeOffering());
    catalog.addQualityEvidence({
      evidence_id: 'ev-1',
      offering_id: 'provider-1/model-1',
      evidence_type: 'benchmark',
      benchmark: 'mmlu',
      domain: 'general',
      task_family: 'general',
      score: 0.8,
      score_scale: '0-1',
      higher_is_better: true,
      sample_size: 100,
      source: 'test',
      source_reference: 'https://example.com',
      measured_at: new Date(),
      version: 'v1',
      confidence: 0.9,
    });
    catalog.addQualityEvidence({
      evidence_id: 'ev-2',
      offering_id: 'provider-1/model-1',
      evidence_type: 'benchmark',
      benchmark: 'humaneval',
      domain: 'coding',
      task_family: 'coding',
      score: 0.7,
      score_scale: '0-1',
      higher_is_better: true,
      sample_size: 50,
      source: 'test',
      source_reference: 'https://example.com',
      measured_at: new Date(),
      version: 'v1',
      confidence: 0.7,
    });

    const score = catalog.getBestQualityScore('provider-1/model-1');
    expect(score).toBeGreaterThan(0.7);
    expect(score).toBeLessThan(0.9);
  });

  it('returns null for unknown evidence', () => {
    expect(catalog.getBestQualityScore('nonexistent')).toBeNull();
  });
});

// ============================================================================
// Benchmark Ingester
// ============================================================================

describe('BenchmarkIngester', () => {
  let catalog: InMemoryModelCatalog;
  let ingester: BenchmarkIngester;

  beforeEach(() => {
    catalog = new InMemoryModelCatalog();
    catalog.addOffering(makeOffering());
    ingester = new BenchmarkIngester();
  });

  it('ingests valid benchmark entries', () => {
    const result = ingester.ingest(
      [
        {
          model_id: 'model-1',
          provider: 'provider-1',
          benchmark: 'mmlu',
          domain: 'general',
          task_family: 'general',
          score: 0.85,
          score_scale: '0-1',
          higher_is_better: true,
          sample_size: 100,
          source: 'test',
          source_reference: 'https://example.com',
          confidence: 0.9,
          version: 'v1',
        },
      ],
      catalog['offerings'],
      (e) => catalog.addQualityEvidence(e)
    );

    expect(result.accepted).toBe(1);
    expect(result.rejected).toBe(0);
  });

  it('rejects entries with missing model_id', () => {
    const result = ingester.ingest(
      [
        {
          model_id: '',
          provider: 'provider-1',
          benchmark: 'mmlu',
          domain: 'general',
          task_family: 'general',
          score: 0.85,
          score_scale: '0-1',
          higher_is_better: true,
          sample_size: 100,
          source: 'test',
          source_reference: 'https://example.com',
          confidence: 0.9,
          version: 'v1',
        },
      ],
      catalog['offerings'],
      (e) => catalog.addQualityEvidence(e)
    );

    expect(result.accepted).toBe(0);
    expect(result.rejected).toBe(1);
    expect(result.errors[0].error).toContain('model_id');
  });

  it('rejects entries with unknown offering', () => {
    const result = ingester.ingest(
      [
        {
          model_id: 'unknown-model',
          provider: 'provider-1',
          benchmark: 'mmlu',
          domain: 'general',
          task_family: 'general',
          score: 0.85,
          score_scale: '0-1',
          higher_is_better: true,
          sample_size: 100,
          source: 'test',
          source_reference: 'https://example.com',
          confidence: 0.9,
          version: 'v1',
        },
      ],
      catalog['offerings'],
      (e) => catalog.addQualityEvidence(e)
    );

    expect(result.rejected).toBe(1);
    expect(result.errors[0].error).toContain('no offering found');
  });

  it('rejects entries with invalid score', () => {
    const result = ingester.ingest(
      [
        {
          model_id: 'model-1',
          provider: 'provider-1',
          benchmark: 'mmlu',
          domain: 'general',
          task_family: 'general',
          score: NaN,
          score_scale: '0-1',
          higher_is_better: true,
          sample_size: 100,
          source: 'test',
          source_reference: 'https://example.com',
          confidence: 0.9,
          version: 'v1',
        },
      ],
      catalog['offerings'],
      (e) => catalog.addQualityEvidence(e)
    );

    expect(result.rejected).toBe(1);
    expect(result.errors[0].error).toContain('score');
  });

  it('rejects entries with invalid confidence', () => {
    const result = ingester.ingest(
      [
        {
          model_id: 'model-1',
          provider: 'provider-1',
          benchmark: 'mmlu',
          domain: 'general',
          task_family: 'general',
          score: 0.85,
          score_scale: '0-1',
          higher_is_better: true,
          sample_size: 100,
          source: 'test',
          source_reference: 'https://example.com',
          confidence: 1.5,
          version: 'v1',
        },
      ],
      catalog['offerings'],
      (e) => catalog.addQualityEvidence(e)
    );

    expect(result.rejected).toBe(1);
    expect(result.errors[0].error).toContain('confidence');
  });

  it('handles mixed valid and invalid entries', () => {
    const result = ingester.ingest(
      [
        {
          model_id: 'model-1',
          provider: 'provider-1',
          benchmark: 'mmlu',
          domain: 'general',
          task_family: 'general',
          score: 0.85,
          score_scale: '0-1',
          higher_is_better: true,
          sample_size: 100,
          source: 'test',
          source_reference: 'https://example.com',
          confidence: 0.9,
          version: 'v1',
        },
        {
          model_id: '',
          provider: 'provider-1',
          benchmark: 'mmlu',
          domain: 'general',
          task_family: 'general',
          score: 0.85,
          score_scale: '0-1',
          higher_is_better: true,
          sample_size: 100,
          source: 'test',
          source_reference: 'https://example.com',
          confidence: 0.9,
          version: 'v1',
        },
      ],
      catalog['offerings'],
      (e) => catalog.addQualityEvidence(e)
    );

    expect(result.accepted).toBe(1);
    expect(result.rejected).toBe(1);
  });
});

// ============================================================================
// Connection Health Tracker
// ============================================================================

describe('ConnectionHealthTracker', () => {
  let tracker: ConnectionHealthTracker;

  beforeEach(() => {
    tracker = new ConnectionHealthTracker({ degraded_threshold: 2, unavailable_threshold: 3 });
  });

  it('starts healthy', () => {
    expect(tracker.getState('acc-1', 'conn-1')).toBe('healthy');
  });

  it('records success', () => {
    tracker.recordSuccess('acc-1', 'conn-1');
    expect(tracker.getState('acc-1', 'conn-1')).toBe('healthy');
  });

  it('transitions to degraded after threshold', () => {
    tracker.recordFailure('acc-1', 'conn-1', 'timeout');
    expect(tracker.getState('acc-1', 'conn-1')).toBe('healthy');
    tracker.recordFailure('acc-1', 'conn-1', 'timeout');
    expect(tracker.getState('acc-1', 'conn-1')).toBe('degraded');
  });

  it('transitions to unavailable after threshold', () => {
    for (let i = 0; i < 3; i++) {
      tracker.recordFailure('acc-1', 'conn-1', 'timeout');
    }
    expect(tracker.getState('acc-1', 'conn-1')).toBe('unavailable');
  });

  it('disables on auth failure', () => {
    tracker.recordFailure('acc-1', 'conn-1', 'auth_failure');
    expect(tracker.getState('acc-1', 'conn-1')).toBe('disabled');
  });

  it('resets on success', () => {
    tracker.recordFailure('acc-1', 'conn-1', 'timeout');
    tracker.recordFailure('acc-1', 'conn-1', 'timeout');
    expect(tracker.getState('acc-1', 'conn-1')).toBe('degraded');
    tracker.recordSuccess('acc-1', 'conn-1');
    expect(tracker.getState('acc-1', 'conn-1')).toBe('healthy');
  });

  it('isolates health by account', () => {
    tracker.recordFailure('acc-1', 'conn-1', 'timeout');
    tracker.recordFailure('acc-1', 'conn-1', 'timeout');
    expect(tracker.getState('acc-1', 'conn-1')).toBe('degraded');
    expect(tracker.getState('acc-2', 'conn-1')).toBe('healthy');
  });

  it('isolates health by connection', () => {
    tracker.recordFailure('acc-1', 'conn-1', 'timeout');
    tracker.recordFailure('acc-1', 'conn-1', 'timeout');
    expect(tracker.getState('acc-1', 'conn-1')).toBe('degraded');
    expect(tracker.getState('acc-1', 'conn-2')).toBe('healthy');
  });

  it('manual disable/enable', () => {
    tracker.disable('acc-1', 'conn-1');
    expect(tracker.getState('acc-1', 'conn-1')).toBe('disabled');
    tracker.enable('acc-1', 'conn-1');
    expect(tracker.getState('acc-1', 'conn-1')).toBe('healthy');
  });
});

// ============================================================================
// Evidence-Based Routing
// ============================================================================

describe('EvidenceBasedRouter', () => {
  let router: EvidenceBasedRouter;

  beforeEach(() => {
    router = new EvidenceBasedRouter();
  });

  it('scores by cost', () => {
    const routes = [
      makeRoute({
        route_id: 'r1',
        pricing: {
          ...makeRoute().pricing,
          input_cost_per_1k_tokens: 0.01,
          output_cost_per_1k_tokens: 0.02,
        },
      }),
      makeRoute({
        route_id: 'r2',
        pricing: {
          ...makeRoute().pricing,
          input_cost_per_1k_tokens: 0.03,
          output_cost_per_1k_tokens: 0.06,
        },
      }),
    ];
    const policy = makePolicy({ ordering_strategy: 'cost' });
    const scores = router.scoreRoutes(routes, policy, new Map(), new Map());
    expect(scores).toHaveLength(2);
    expect(scores![0].route_id).toBe('r1');
    expect(scores![0].cost_score).toBeGreaterThan(scores![1].cost_score);
  });

  it('scores by quality with evidence', () => {
    const routes = [
      makeRoute({ route_id: 'r1', connection_id: 'conn-1' }),
      makeRoute({ route_id: 'r2', connection_id: 'conn-2' }),
    ];
    const policy = makePolicy({ ordering_strategy: 'quality' });
    const qualityScores = new Map([
      ['r1', 0.9],
      ['r2', 0.7],
    ]);
    const scores = router.scoreRoutes(routes, policy, qualityScores, new Map());
    expect(scores).toHaveLength(2);
    expect(scores![0].route_id).toBe('r1');
    expect(scores![0].quality_score).toBe(0.9);
  });

  it('fails closed for quality without evidence', () => {
    const routes = [makeRoute({ route_id: 'r1' })];
    const policy = makePolicy({ ordering_strategy: 'quality' });
    const scores = router.scoreRoutes(routes, policy, new Map(), new Map());
    expect(scores).toBeNull();
  });

  it('applies health penalty', () => {
    const routes = [
      makeRoute({ route_id: 'r1', connection_id: 'conn-1' }),
      makeRoute({ route_id: 'r2', connection_id: 'conn-2' }),
    ];
    const policy = makePolicy({ ordering_strategy: 'cost' });
    const healthStates = new Map([['conn-1', 'degraded' as const]]);
    const scores = router.scoreRoutes(routes, policy, new Map(), healthStates);
    expect(scores).toHaveLength(2);
    expect(scores![0].health_penalty).toBeGreaterThan(0);
  });

  it('scores balanced with cost and quality', () => {
    const routes = [
      makeRoute({
        route_id: 'r1',
        pricing: {
          ...makeRoute().pricing,
          input_cost_per_1k_tokens: 0.01,
          output_cost_per_1k_tokens: 0.02,
        },
      }),
      makeRoute({
        route_id: 'r2',
        pricing: {
          ...makeRoute().pricing,
          input_cost_per_1k_tokens: 0.03,
          output_cost_per_1k_tokens: 0.06,
        },
      }),
    ];
    const policy = makePolicy({ ordering_strategy: 'balanced' });
    const qualityScores = new Map([
      ['r1', 0.7],
      ['r2', 0.9],
    ]);
    const scores = router.scoreRoutes(routes, policy, qualityScores, new Map());
    expect(scores).toHaveLength(2);
  });

  it('fails closed for balanced without quality evidence', () => {
    const routes = [makeRoute({ route_id: 'r1' })];
    const policy = makePolicy({ ordering_strategy: 'balanced' });
    const scores = router.scoreRoutes(routes, policy, new Map(), new Map());
    expect(scores).toBeNull();
  });

  it('fails closed for latency strategy', () => {
    const routes = [makeRoute({ route_id: 'r1' })];
    const policy = makePolicy({ ordering_strategy: 'latency' });
    const scores = router.scoreRoutes(routes, policy, new Map(), new Map());
    expect(scores).toBeNull();
  });
});

describe('rankByScore', () => {
  it('ranks by total score descending', () => {
    const scores = [
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
        total_score: 0.8,
        cost_score: 0.8,
        quality_score: 0,
        health_penalty: 0,
        reasons: [],
      },
      {
        route_id: 'r3',
        total_score: 0.3,
        cost_score: 0.3,
        quality_score: 0,
        health_penalty: 0,
        reasons: [],
      },
    ];
    const ranked = rankByScore(scores);
    expect(ranked[0].route_id).toBe('r2');
    expect(ranked[1].route_id).toBe('r1');
    expect(ranked[2].route_id).toBe('r3');
  });

  it('breaks ties deterministically by route_id', () => {
    const scores = [
      {
        route_id: 'r2',
        total_score: 0.5,
        cost_score: 0.5,
        quality_score: 0,
        health_penalty: 0,
        reasons: [],
      },
      {
        route_id: 'r1',
        total_score: 0.5,
        cost_score: 0.5,
        quality_score: 0,
        health_penalty: 0,
        reasons: [],
      },
    ];
    const ranked = rankByScore(scores);
    expect(ranked[0].route_id).toBe('r1');
    expect(ranked[1].route_id).toBe('r2');
  });
});

describe('explainRoutingDecision', () => {
  it('explains reasons for each route', () => {
    const scores = [
      {
        route_id: 'r1',
        total_score: 0.5,
        cost_score: 0.5,
        quality_score: 0,
        health_penalty: 0,
        reasons: ['health_degraded'],
      },
      {
        route_id: 'r2',
        total_score: 0.8,
        cost_score: 0.8,
        quality_score: 0,
        health_penalty: 0,
        reasons: [],
      },
    ];
    const explanation = explainRoutingDecision(scores);
    expect(explanation).toHaveLength(1);
    expect(explanation[0]).toContain('r1');
    expect(explanation[0]).toContain('health_degraded');
  });
});
