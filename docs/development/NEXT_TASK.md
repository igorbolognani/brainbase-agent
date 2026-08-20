# Next Task

## Phase 1B — Bounded Retry, Fallback, and Cancellation

Phase 1A provides authenticated deterministic synthetic execution. The next checkpoint adds bounded retry, immutable fallback decisions, and explicit attempt cancellation without enabling real provider calls.

### Required

- Extend verification outcomes with `retryable_failure`.
- Apply a bounded retry policy with deterministic scheduling and budget checks before every dispatch.
- Create a new execution attempt for every retry and a new immutable routing decision for fallback.
- Preserve usage and audit evidence for every dispatched attempt.
- Implement `cancel_execution(attempt_id)` with idempotent cancellation and truthful completion races.
- Keep account authorization, idempotency, secret-safe output, and provider/paid-call disablement intact.

### Do not implement yet

- real paid provider execution;
- generic workflow/node editor;
- private/local gateway bridge;
- production database deployment;
- uncontrolled autonomous agent execution.

### Exit gate

The full clean gate plus retry, fallback, cancellation, account-isolation, and real HTTP MCP regressions must be green before Phase 1C begins.
