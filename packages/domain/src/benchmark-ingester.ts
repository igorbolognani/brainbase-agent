/**
 * Deterministic benchmark/evaluation data ingestion.
 * Validates incoming data, rejects malformed entries.
 * No autonomous web scraping; repository-controlled ingestion only.
 */

import type { ModelQualityEvidence, ModelOffering } from '@gptrouter/contracts';

export interface BenchmarkEntry {
  model_id: string;
  provider: string;
  benchmark: string;
  domain: string;
  task_family: string;
  score: number;
  score_scale: string;
  higher_is_better: boolean;
  sample_size: number;
  source: string;
  source_reference: string;
  confidence: number;
  version: string;
}

export interface IngestionResult {
  accepted: number;
  rejected: number;
  errors: Array<{ entry: Partial<BenchmarkEntry>; error: string }>;
}

export class BenchmarkIngester {
  private static readonly VALID_CONFIDENCE_RANGE = { min: 0, max: 1 };

  ingest(
    entries: BenchmarkEntry[],
    offerings: Map<string, ModelOffering>,
    importFn: (evidence: Omit<ModelQualityEvidence, 'ingested_at'>) => void
  ): IngestionResult {
    const result: IngestionResult = { accepted: 0, rejected: 0, errors: [] };

    for (const entry of entries) {
      const validation = this.validate(entry, offerings);
      if (!validation.valid) {
        result.rejected++;
        result.errors.push({ entry, error: validation.error! });
        continue;
      }

      const offering_id = `${entry.provider}/${entry.model_id}`;
      importFn({
        evidence_id: `bench_${entry.provider}_${entry.model_id}_${entry.benchmark}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        offering_id,
        evidence_type: 'benchmark',
        benchmark: entry.benchmark,
        domain: entry.domain,
        task_family: entry.task_family,
        score: entry.score,
        score_scale: entry.score_scale,
        higher_is_better: entry.higher_is_better,
        sample_size: entry.sample_size,
        source: entry.source,
        source_reference: entry.source_reference,
        measured_at: new Date(),
        version: entry.version,
        confidence: entry.confidence,
      });
      result.accepted++;
    }

    return result;
  }

  private validate(
    entry: BenchmarkEntry,
    offerings: Map<string, ModelOffering>
  ): { valid: boolean; error?: string } {
    if (!entry.model_id || typeof entry.model_id !== 'string') {
      return { valid: false, error: 'missing or invalid model_id' };
    }
    if (!entry.provider || typeof entry.provider !== 'string') {
      return { valid: false, error: 'missing or invalid provider' };
    }
    const offering_id = `${entry.provider}/${entry.model_id}`;
    if (!offerings.has(offering_id)) {
      return { valid: false, error: `no offering found for ${offering_id}` };
    }
    if (!entry.benchmark || typeof entry.benchmark !== 'string') {
      return { valid: false, error: 'missing or invalid benchmark' };
    }
    if (!entry.domain || typeof entry.domain !== 'string') {
      return { valid: false, error: 'missing or invalid domain' };
    }
    if (!entry.task_family || typeof entry.task_family !== 'string') {
      return { valid: false, error: 'missing or invalid task_family' };
    }
    if (typeof entry.score !== 'number' || !isFinite(entry.score)) {
      return { valid: false, error: 'missing or invalid score' };
    }
    if (!entry.score_scale || typeof entry.score_scale !== 'string') {
      return { valid: false, error: 'missing or invalid score_scale' };
    }
    if (typeof entry.higher_is_better !== 'boolean') {
      return { valid: false, error: 'missing or invalid higher_is_better' };
    }
    if (
      typeof entry.sample_size !== 'number' ||
      entry.sample_size < 0 ||
      !Number.isInteger(entry.sample_size)
    ) {
      return { valid: false, error: 'sample_size must be a non-negative integer' };
    }
    if (!entry.source || typeof entry.source !== 'string') {
      return { valid: false, error: 'missing or invalid source' };
    }
    if (!entry.source_reference || typeof entry.source_reference !== 'string') {
      return { valid: false, error: 'missing or invalid source_reference' };
    }
    if (typeof entry.confidence !== 'number' || !isFinite(entry.confidence)) {
      return { valid: false, error: 'missing or invalid confidence' };
    }
    if (
      entry.confidence < BenchmarkIngester.VALID_CONFIDENCE_RANGE.min ||
      entry.confidence > BenchmarkIngester.VALID_CONFIDENCE_RANGE.max
    ) {
      return { valid: false, error: `confidence ${entry.confidence} outside valid range [0, 1]` };
    }
    if (!entry.version || typeof entry.version !== 'string') {
      return { valid: false, error: 'missing or invalid version' };
    }
    return { valid: true };
  }
}
