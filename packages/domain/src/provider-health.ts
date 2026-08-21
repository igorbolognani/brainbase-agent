/**
 * Provider health tracking with bounded failure counters.
 * Circuit-like behavior: tracks consecutive failures and exposes health state.
 * Inject clock for deterministic testing.
 */

export type ProviderHealthState = 'healthy' | 'degraded' | 'unavailable';

export interface ProviderHealthEntry {
  provider: string;
  state: ProviderHealthState;
  consecutive_failures: number;
  last_success_at: Date | null;
  last_failure_at: Date | null;
  total_successes: number;
  total_failures: number;
}

export interface ProviderHealthTrackerOptions {
  degraded_threshold?: number;
  unavailable_threshold?: number;
  recovery_successes?: number;
  clock?: () => Date;
}

export class ProviderHealthTracker {
  private readonly entries = new Map<string, ProviderHealthEntry>();
  private readonly degraded_threshold: number;
  private readonly unavailable_threshold: number;
  private readonly clock: () => Date;

  constructor(options: ProviderHealthTrackerOptions = {}) {
    this.degraded_threshold = options.degraded_threshold ?? 2;
    this.unavailable_threshold = options.unavailable_threshold ?? 5;
    this.clock = options.clock ?? (() => new Date());
  }

  private getOrCreate(provider: string): ProviderHealthEntry {
    let entry = this.entries.get(provider);
    if (!entry) {
      entry = {
        provider,
        state: 'healthy',
        consecutive_failures: 0,
        last_success_at: null,
        last_failure_at: null,
        total_successes: 0,
        total_failures: 0,
      };
      this.entries.set(provider, entry);
    }
    return entry;
  }

  recordSuccess(provider: string): void {
    const entry = this.getOrCreate(provider);
    entry.consecutive_failures = 0;
    entry.last_success_at = this.clock();
    entry.total_successes += 1;
    if (entry.state !== 'healthy') {
      entry.state = 'healthy';
    }
  }

  recordFailure(provider: string): void {
    const entry = this.getOrCreate(provider);
    entry.consecutive_failures += 1;
    entry.last_failure_at = this.clock();
    entry.total_failures += 1;

    if (entry.consecutive_failures >= this.unavailable_threshold) {
      entry.state = 'unavailable';
    } else if (entry.consecutive_failures >= this.degraded_threshold) {
      entry.state = 'degraded';
    }
  }

  getHealth(provider: string): ProviderHealthState {
    const entry = this.entries.get(provider);
    return entry?.state ?? 'healthy';
  }

  getEntry(provider: string): ProviderHealthEntry {
    const entry = this.getOrCreate(provider);
    return { ...entry };
  }

  getAllEntries(): ProviderHealthEntry[] {
    return [...this.entries.values()].map((e) => ({ ...e }));
  }

  reset(provider: string): void {
    const entry = this.getOrCreate(provider);
    entry.consecutive_failures = 0;
    entry.state = 'healthy';
  }

  resetAll(): void {
    this.entries.clear();
  }
}
