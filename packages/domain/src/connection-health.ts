/**
 * Connection-scoped health tracker.
 * Health is scoped by account_id + connection_id, NOT globally by provider.
 * One broken Gemini credential must not affect another account's Gemini connection.
 */

import type { HealthState } from '@gptrouter/contracts';

export interface HealthEvent {
  type:
    | 'success'
    | 'rate_limit'
    | 'timeout'
    | 'provider_unavailable'
    | 'auth_failure'
    | 'authz_failure'
    | 'unknown_error';
  timestamp: Date;
}

export interface ConnectionHealthState {
  state: HealthState;
  last_success: Date | null;
  last_failure: Date | null;
  consecutive_failures: number;
  events: HealthEvent[];
}

export interface ConnectionHealthTrackerOptions {
  degraded_threshold?: number;
  unavailable_threshold?: number;
  recovery_after_ms?: number;
  clock?: () => Date;
}

const DEFAULTS = {
  degraded_threshold: 3,
  unavailable_threshold: 5,
  recovery_after_ms: 60_000,
};

export class ConnectionHealthTracker {
  private readonly health = new Map<string, ConnectionHealthState>();
  private readonly degraded_threshold: number;
  private readonly unavailable_threshold: number;
  private readonly recovery_after_ms: number;
  private readonly clock: () => Date;

  constructor(options: ConnectionHealthTrackerOptions = {}) {
    this.degraded_threshold = options.degraded_threshold ?? DEFAULTS.degraded_threshold;
    this.unavailable_threshold = options.unavailable_threshold ?? DEFAULTS.unavailable_threshold;
    this.recovery_after_ms = options.recovery_after_ms ?? DEFAULTS.recovery_after_ms;
    this.clock = options.clock ?? (() => new Date());
  }

  private key(account_id: string, connection_id: string): string {
    return `${account_id}:${connection_id}`;
  }

  getState(account_id: string, connection_id: string): HealthState {
    const k = this.key(account_id, connection_id);
    const s = this.health.get(k);
    if (!s) return 'healthy';
    if (s.state === 'disabled') return 'disabled';
    if (s.state === 'unavailable' && s.last_failure) {
      const elapsed = this.clock().getTime() - s.last_failure.getTime();
      if (elapsed >= this.recovery_after_ms) return 'degraded';
    }
    return s.state;
  }

  recordSuccess(account_id: string, connection_id: string): void {
    const k = this.key(account_id, connection_id);
    const now = this.clock();
    const existing = this.health.get(k);
    const state: ConnectionHealthState = existing ?? {
      state: 'healthy',
      last_success: null,
      last_failure: null,
      consecutive_failures: 0,
      events: [],
    };
    state.state = 'healthy';
    state.last_success = now;
    state.consecutive_failures = 0;
    state.events.push({ type: 'success', timestamp: now });
    if (state.events.length > 100) state.events.splice(0, state.events.length - 100);
    this.health.set(k, state);
  }

  recordFailure(account_id: string, connection_id: string, eventType: HealthEvent['type']): void {
    const k = this.key(account_id, connection_id);
    const now = this.clock();
    const existing = this.health.get(k);
    const state: ConnectionHealthState = existing ?? {
      state: 'healthy',
      last_success: null,
      last_failure: null,
      consecutive_failures: 0,
      events: [],
    };
    state.last_failure = now;
    state.consecutive_failures += 1;
    state.events.push({ type: eventType, timestamp: now });
    if (state.events.length > 100) state.events.splice(0, state.events.length - 100);

    if (eventType === 'auth_failure' || eventType === 'authz_failure') {
      state.state = 'disabled';
    } else if (state.consecutive_failures >= this.unavailable_threshold) {
      state.state = 'unavailable';
    } else if (state.consecutive_failures >= this.degraded_threshold) {
      state.state = 'degraded';
    }
    this.health.set(k, state);
  }

  disable(account_id: string, connection_id: string): void {
    const k = this.key(account_id, connection_id);
    const existing = this.health.get(k);
    const state: ConnectionHealthState = existing ?? {
      state: 'disabled',
      last_success: null,
      last_failure: null,
      consecutive_failures: 0,
      events: [],
    };
    state.state = 'disabled';
    this.health.set(k, state);
  }

  enable(account_id: string, connection_id: string): void {
    const k = this.key(account_id, connection_id);
    const existing = this.health.get(k);
    if (existing) {
      existing.state = 'healthy';
      existing.consecutive_failures = 0;
      this.health.set(k, existing);
    }
  }

  getAllHealth(): Map<string, ConnectionHealthState> {
    return new Map(this.health);
  }

  getHealthForAccount(account_id: string): Map<string, ConnectionHealthState> {
    const result = new Map<string, ConnectionHealthState>();
    for (const [k, v] of this.health) {
      if (k.startsWith(`${account_id}:`)) {
        result.set(k.slice(account_id.length + 1), v);
      }
    }
    return result;
  }
}
