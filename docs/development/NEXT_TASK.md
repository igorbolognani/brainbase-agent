# Next Task

## Phase 1D — Provider/Gateway Execution Boundary, FAKE ADAPTERS ONLY

Phase 1C provides execution observability, truthful usage filtering, real Activity/Audit projection, dashboard updates, and modern MCP HTTP protocol support — all in synthetic mode. The next checkpoint adds the provider/gateway execution boundary behind fake adapters while preserving all Phase 1A/1B/1C invariants.

### Required

- Implement `GatewayExecutor` interface that dispatches to configured provider gateway URLs with SSRF protection (HTTPS required, DNS/IP validation, block loopback/private/link-local/cloud-metadata).
- **FAKE ADAPTERS ONLY** — no real provider/gateway calls. Implement synthetic adapters that simulate provider behavior (latency, errors, token usage) for testing the gateway boundary.
- Pluggable credential resolution via `ProviderConnection` and `GatewayConnection` — never pass raw credentials through MCP or model-visible context. Return opaque connection IDs only.
- Gateway request/response translation for OpenAI-compatible chat completions and embeddings.
- Actual cost reconciliation from provider `usage` fields with provenance; synthetic actual cost remains zero in synthetic mode.
- Preserve all Phase 1B retry/fallback/cancellation semantics with gateway calls (deterministic scheduling, budget re-check, attempt immutability, idempotency, audit).
- Structured logging with allowlist + central redaction defense-in-depth; never rely solely on regex for secret safety.
- MCP `run_task` tool dispatches to fake gateway adapter when `provider_execution_enabled: true` (off by default in synthetic mode).

### Do not implement yet

- Real paid provider execution (deferred until after synthetic release candidate)
- Generic workflow/node editor
- Private/local gateway bridge
- Production database deployment
- Uncontrolled autonomous agent execution
- `provider_execution_enabled=true` in this session

### Exit gate

The full clean gate plus gateway boundary tests (SSRF validation, credential boundary, fake adapter behavior, retry/fallback/cancellation with gateway, usage reconciliation) must be green before Phase 1E begins.
