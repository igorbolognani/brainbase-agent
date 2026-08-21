/**
 * Deterministic benchmark/evaluation data ingestion.
 * Validates incoming data, rejects malformed entries.
 * No autonomous web scraping; repository-controlled ingestion only.
 */

import type { ModelQualityEvidence } from './model-catalog.js';

export interface BenchmarkEntry {
  model_id: string;
  provider: string;
  benchmark: string;
  domain: string;
  score: number;
  sample_size: number;
  source: string;
  confidence: number;
  version: string;
}

export interface IngestionResult {
  accepted: number;
  rejected: number;
  errors: Array<{ entry: BenchmarkEntry; error: string }>;
}

export class BenchmarkIngester {
  private static readonly VALID_SCORE_RANGE = { min: 0, max: 1 };
  private static readonly VALID_CONFIDENCE_RANGE = { min: 0, max: 1 };

  /**
   * Validate and import benchmark entries.
   * Rejects malformed entries without crashing.
   */
  ingest(
    entries: BenchmarkEntry[],
    importFn: (evidence: Omit<ModelQualityEvidence, 'effective_at'>) => void
  ): IngestionResult {
    const result: IngestionResult = { accepted: 0, rejected: 0, errors: [] };

    for (const entry of entries) {
      const validation = this.validate(entry);
      if (!validation.valid) {
        result.rejected++;
        result.errors.push({ entry, error: validation.error! });
        continue;
      }

      importFn({
        evidence_id: `bench_${entry.provider}_${entry.model_id}_${entry.benchmark}_${Date.now()}`,
        model_id: entry.model_id,
        provider: entry.provider,
        benchmark: entry.benchmark,
        domain: entry.domain,
        score: entry.score,
        sample_size: entry.sample_size,
        source: entry.source,
        confidence: entry.confidence,
        version: entry.version,
      });
      result.accepted++;
    }

    return result;
  }

  private validate(entry: BenchmarkEntry): { valid: boolean; error?: string } {
    if (!entry.model_id || typeof entry.model_id !== 'string') {
      return { valid: false, error: 'missing or invalid model_id' };
    }
    if (!entry.provider || typeof entry.provider !== 'string') {
      return { valid: false, error: 'missing or invalid provider' };
    }
    if (!entry.benchmark || typeof entry.benchmark !== 'string') {
      return { valid: false, error: 'missing or invalid benchmark' };
    }
    if (!entry.domain || typeof entry.domain !== 'string') {
      return { valid: false, error: 'missing or invalid domain' };
    }
    if (typeof entry.score !== 'number' || !isFinite(entry.score)) {
      return { valid: false, error: 'missing or invalid score' };
    }
    if (entry.score < BenchmarkIngester.VALID_SCORE_RANGE.min || entry.score > BenchmarkIngester.VALID_SCORE_RANGE.max) {
      return { valid: false, error: `score ${entry.score} outside valid range [0, 1]` };
    }
    if (typeof entry.sample_size !== 'number' || entry.sample_size < 0 || !Number.isInteger(entry.sample_size)) {
      return { valid: false, error: 'sample_size must be a non-negative integer' };
    }
    if (!entry.source || typeof entry.source !== 'string') {
      return { valid: false, error: 'missing or invalid source' };
    }
    if (typeof entry.confidence !== 'number' || !isFinite(entry.confidence)) {
      return { valid: false, error: 'missing or invalid confidence' };
    }
    if (entry.confidence < BenchmarkIngester.VALID_CONFIDENCE_RANGE.min || entry.confidence > BenchmarkIngester.VALID_CONFIDENCE_RANGE.max) {
      return { valid: false, error: `confidence ${entry.confidence} outside valid range [0, 1]` };
    }
    if (!entry.version || typeof entry.version !== 'string') {
      return { valid: false, error: 'missing or invalid version' };
    }
    return { valid: true };
  }
}
