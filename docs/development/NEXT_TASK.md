# Next Task

## Phase 1C — Real Provider Execution Gateway Integration

Phase 1B provides bounded retry, fallback, and cancellation for deterministic synthetic execution. The next checkpoint adds real provider execution behind the gateway boundary while preserving all Phase 1A/1B invariants.

### Required

- Implement `GatewayExecutor` that dispatches to configured provider gateway URLs with SSRF protection (HTTPS required, DNS/IP validation, block loopback/private/link-local/cloud-metadata).
- Pluggable credential resolution via `ProviderConnection` and `GatewayConnection` — never pass raw credentials through MCP or model-visible context.
- Gateway request/response translation for OpenAI-compatible chat completions and embeddings.
- Actual cost reconciliation from provider `usage` fields with provenance; synthetic actual cost remains zero in synthetic mode.
- Preserve all Phase 1B retry/fallback/cancellation semantics with real provider calls (deterministic scheduling, budget re-check, attempt immutability, idempotency, audit).
- Structured logging with allowlist + central redaction defense-in-depth; never rely solely on regex for secret safety.
- MCP `run_task` tool dispatches to real gateway when `provider_execution_enabled: true` (off by default in synthetic mode).

### Do not implement yet

- generic workflow/node editor;
- private/local gateway bridge;
- production database deployment;
- uncontrolled autonomous agent execution.

### Exit gate

The full clean gate plus real gateway dispatch, credential boundary, SSRF validation, usage reconciliation, and regression of all Phase 1B retry/fallback/cancellation tests must be green before proceeding.