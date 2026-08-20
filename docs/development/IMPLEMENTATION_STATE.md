# Implementation State

Integration branch: `feat/gptrouter-v0-system-design`

Original verified baseline for this sequence: `20ea09a734269aa630650180831fc8c2b5b26d39`.

## Green

- Phase 0A verification truth restored.
- Deterministic GitHub Actions CI enforces install, formatting, lint, typecheck, tests, clean build, audit, and generated-output hygiene.
- MCP TypeScript SDK v2 structure is shared by stdio and HTTP adapters.
- Phase 0B remote MCP transport boundary is implemented and CI-verified.
- Phase 0D safe outbound gateway dispatch is implemented and CI-verified.
- Phase 0E runtime tenant, OAuth resource-server, and secret-output boundaries are implemented and CI-verified.
- Phase 0C connection-metadata-aware HTTPS routing is implemented and CI-verified.
- Phase 0F Plugin / MCP Apps UI is implemented and CI-verified on its work branch:
  - versioned `ui://gptrouter/dashboard-v1.html` resource;
  - MIME type `text/html;profile=mcp-app`;
  - dedicated `render_gptrouter_dashboard` render tool linked with `_meta.ui.resourceUri`;
  - `openai/outputTemplate` retained only as a compatibility alias;
  - stable MCP Apps `2026-01-26` view handshake with `appInfo`, `appCapabilities`, and `ui/notifications/initialized`;
  - complete 11-section GPTRouter navigation shell;
  - functional-shell priority for Overview, Router, Tasks, Engineering, Models, Providers & Connections, Model Gateways / Proxies, and Usage & Budgets;
  - Security & Permissions, Activity / Audit, and Settings remain placeholders;
  - structured and visible synthetic/no-spend state;
  - no external UI assets;
  - no `run_task`, provider execution, or paid calls.
- Phase 0G synthetic repository-backed vertical slice is implemented and CI-verified:
  - single authoritative `GPTRouterApplication` over in-memory synthetic repositories;
  - `list_models`, `route_task`, `get_task`, `get_usage`, and dashboard all read from the same shared application state;
  - `route_task` invokes the real `RoutingEngine` and persists planned tasks and routing decisions;
  - `get_task` in a separate MCP request retrieves the previous plan;
  - estimated/planned cost is tracked separately from actual cost; actual provider spend is zero;
  - no `run_task`, no execution adapters, no outbound provider/gateway dispatch, no paid calls;
  - secret-like values do not appear in public tool outputs;
  - workspace test resolution maps `@gptrouter/*` packages to source so `npm test` passes without pre-existing `dist`.
- Phase 1A authorized synthetic execution is implemented and locally clean-gate verified:
  - verified OAuth `AuthInfo` is reduced to identity claims before principal, membership, and account authorization;
  - remote consequential execution fails closed without verified authorization and never defaults to the synthetic account;
  - `run_task` is explicit approval plus execution with server-side budget re-check, account-scoped idempotency, and canonical attempt transitions;
  - deterministic `SyntheticExecutor` and verifier seam perform no network or provider calls;
  - actual synthetic usage is reconciled at zero cost exactly once per attempt and planning estimates remain separate;
  - execution audit events are sanitized and account-scoped;
  - MCP and dashboard surfaces expose synthetic execution as enabled while provider execution and paid calls remain disabled.
- Phase 1B bounded retry, fallback, and cancellation is implemented and locally clean-gate verified:
  - `retryable_failure` verification outcome with bounded retries, deterministic scheduling, and new `ExecutionAttempt` per retry;
  - immutable fallback creates a new `RoutingDecision` via `FallbackPlanner`, excludes failed/inadmissible routes, re-checks policy and budget, never escalates cost silently;
  - `cancel_execution(attempt_id)` with idempotent semantics: `pending → cancelled`, `running → cancel_requested → cancelled`, completion wins race;
  - CAS/expected-state transitions on task and attempt repositories prevent competing transitions;
  - stable `execution_id` root identity across retry/fallback attempts; `account_id + idempotency_key` uniqueness for root attempts only;
  - every dispatched attempt preserves independent `UsageRecord` evidence; retries/fallbacks never erase earlier usage; no double-charging under idempotent replay;
  - audit events for `task.execution.retry_scheduled`, `task.execution.retry_exhausted`, `routing.fallback`, `task.execution.cancel_requested`, `task.execution.cancelled`; audit failures never trigger redispatch; metadata remains secret-safe;
  - MCP consequential tools: `run_task`, `cancel_execution`; `route_task` remains planning-only/no-spend; no UI/read operation causes execution.
- Phase 1C execution observability + modern MCP runtime is implemented and locally clean-gate verified:
  - `get_task` exposes safe account-scoped execution history with task state, all routing decisions, `execution_id`, attempts with parent relationships, retry/fallback provenance, latest attempt, verification results, cancellation state, reconciled usage, estimated/actual cost, cost variance, audit degradation. New fields: `decision_tree`, `attempt_tree`.
  - `get_usage` implements truthful today/week/month filtering using injected clock (`SyntheticApplicationOptions.clock`). Exposes: planning requests, root executions, attempts, completed, failed, cancelled, estimated planned cost, actual cost, variance. Account-scoped.
  - `get_audit_events` tool: account-scoped activity/audit projection backed by `AuditRepository`. Bounded results (max 100, default 50), allowlisted fields only, sanitized metadata via `safeAuditMetadata`, no secret-bearing blobs. Pagination via `limit`/`offset`, filter by `event_type`.
  - Dashboard updated: Overview, Tasks, Usage & Budgets, Activity / Audit (now functional shell), Security & Permissions. Shows retry count, fallback count, cancellation state, actual vs estimated, audit degraded. `synthetic_execution_enabled=true`, `provider_execution_enabled=false`, `paid_calls_enabled=false`.
  - Modern MCP HTTP: Real Node HTTP tests exercise `initialize`, `tools/list`, `tools/call`, `resources/list`, `resources/read`. Protocol version `2025-06-18` negotiated. **Streamable HTTP is stateless** — no `Mcp-Session-Id` header returned, no session propagation, each request creates a fresh per-request transport. SSE used for response streaming; no SSE disconnect cancellation implemented.
  - Consequential/read-only metadata: Tool annotations set per MCP SDK (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`). No invented annotations.
  - No real provider execution; `provider_execution_enabled=false` throughout.
- Phase 1D Provider/Gateway Execution Boundary with FAKE ADAPTERS ONLY is implemented and locally clean-gate verified:
  - `ProviderAdapter` interface and `ProviderAdapterRegistry` provide explicit execution seam between orchestration and provider-specific behavior.
  - `FakeProviderAdapter` implements deterministic synthetic outcomes: SUCCESS, RETRYABLE_FAILURE, TERMINAL_FAILURE, TIMEOUT, RATE_LIMIT, UNAVAILABLE, HOLD, CANCELLATION.
  - Opaque connection references only (`connection_id`) — no raw credentials ever enter execution requests; security violation throws on `api_key`, `secret`, `access_token`.
  - `AdapterExecutionCoordinatorBridge` translates domain `ExecutionInput` to provider-neutral `ProviderExecutionRequest` and normalizes results to `ExecutionOutput`.
  - `AdapterExecutionVerifier` classifies fake adapter outcomes into existing `VerificationOutcome` taxonomy (`accepted` / `retryable_failure` / `terminal_failure`).
  - All Phase 1B retry/fallback/cancellation semantics preserved: new `ExecutionAttempt` per retry, immutable fallback creates new `RoutingDecision`, CAS transitions, budget re-checked before every dispatch, idempotent replay no double-charge.
  - Usage normalization: one `UsageRecord` per dispatched attempt, retry/fallback usage retained, actual cost aggregation correct, estimated planning cost distinct.
  - Security: unknown adapter fails closed (`unknown_adapter`), invalid connection reference fails closed, account isolation enforced, read-only tools never dispatch, secret-safe projections.
  - Feature gate: `provider_execution_enabled: false`, `paid_calls_enabled: false` — real provider execution remains structurally impossible.
  - 5 new domain tests for fake adapter boundary.
- Phase 1E V0.1 Synthetic Release Candidate is implemented and locally clean-gate verified:
  - Integrated synthetic E2E flow verified: authorize -> plan -> route -> execute -> fake adapter -> verify -> reconcile usage -> audit -> get_task -> get_usage -> dashboard.
  - Failure/degradation paths proven: retry exhaustion, fallback denial, cancellation race, audit degradation, invalid provider/connection, budget denial.
  - MCP vertical slice verified: initialize, tools/list, resources/list, resources/read, route_task, run_task, get_task, get_usage, get_audit_events, cancel_execution, render_gptrouter_dashboard.
  - Product/runtime projections truthful: routing decisions, attempts, retries, fallback, cancellation, usage, actual vs estimated cost, audit degradation, `synthetic_execution_enabled=true`, `provider_execution_enabled=false`, `paid_calls_enabled=false`.
  - No fabricated production telemetry; functional shells correspond to actual backing tools.
- Current full locally clean-gate test inventory: 193 unique tests (contracts 6, domain 45, MCP server 77, security 65).
- Cost routing remains operational; unsupported quality/latency/custom ordering fails closed.

## Authentication deployment boundary

The repository provides the standards-shaped OAuth resource-server boundary and tenant authorization service. A deployment must still provide a concrete OAuth/OIDC access-token verifier configured for its chosen authorization server, including issuer/audience/resource validation as required by that verifier. GPTRouter does not issue access tokens and does not pass provider/gateway credentials through MCP.

## Platform terminology

Current OpenAI developer documentation describes installable ChatGPT/Codex extensions as **Plugins**. GPTRouter uses the open **MCP Apps** UI standard for custom MCP UI and keeps ChatGPT-specific compatibility metadata isolated from the portable UI contract.

## Current

Phase 1D and Phase 1E are complete. V0.1 Synthetic Release Candidate is verified.

## Canonical remaining order

1. Phase 0G — synthetic repository-backed vertical slice (complete).
2. Phase 1A — authorized synthetic execution (complete).
3. Phase 1B — bounded retry, fallback, and cancellation (complete).
4. Phase 1C — execution observability + modern MCP runtime (complete).
5. Phase 1D — Provider/Gateway Execution Boundary, FAKE ADAPTERS ONLY (complete).
6. Phase 1E — V0.1 Synthetic Release Candidate (complete).
7. Real provider execution is deferred until after the synthetic release candidate and independent review.
8. Final clean verification and release-readiness review.

## Completion rule

Do not create `DEVELOPMENT_COMPLETE.md` until the full clean gate and the targeted MCP/security/UI/vertical-slice/orchestration checks are green with evidence.
