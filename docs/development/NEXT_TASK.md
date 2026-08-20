# Next Task

## Phase 1D — COMPLETE

Provider/Gateway Execution Boundary with FAKE ADAPTERS ONLY has been implemented and verified:

- `ProviderAdapter` / `ProviderAdapterRegistry` execution seam
- `FakeProviderAdapter` with deterministic outcomes: SUCCESS, RETRYABLE_FAILURE, TERMINAL_FAILURE, TIMEOUT, RATE_LIMIT, UNAVAILABLE, HOLD, CANCELLATION
- Opaque connection references only — no credentials in execution requests
- `AdapterExecutionCoordinatorBridge` + `AdapterExecutionVerifier` integration
- All Phase 1B retry/fallback/cancellation semantics preserved
- Security: unknown adapter fails closed, account isolation, secret-safe projections
- Feature gate: `provider_execution_enabled: false`, `paid_calls_enabled: false`

## Phase 1E — COMPLETE

V0.1 Synthetic Release Candidate verified:

- Integrated synthetic E2E flow: authorize -> plan -> route -> execute -> fake adapter -> verify -> reconcile -> audit -> projections
- Failure/degradation paths: retry exhaustion, fallback denial, cancellation, audit degradation, invalid provider, budget denial
- MCP surface: initialize, tools/list, resources/list/read, route_task, run_task, get_task, get_usage, get_audit_events, cancel_execution, dashboard
- Product projections truthful: decisions, attempts, retries, fallback, cancellation, usage, actual vs estimated, audit, feature flags
- 193 total tests passing (contracts 6, domain 45, MCP server 77, security 65)

## NEXT PHASE — Real Provider Execution (Deferred)

Per the canonical roadmap, real provider execution is deferred until after the synthetic release candidate and independent review.

### Potential next vertical slice candidates (to be determined by architectural review):

1. **Durable repository persistence** — Replace in-memory repositories with persistent storage (PostgreSQL, etc.)
2. **Real credential-resolution seam** — Implement `ProviderConnection` / `GatewayConnection` credential resolution via secure OAuth/OIDC or encrypted storage
3. **Private gateway bridge** — Local/private gateway execution for self-hosted models
4. **Real provider execution under explicit feature gate** — Enable `provider_execution_enabled: true` with real adapters (OpenAI, Anthropic, OpenRouter, etc.)
5. **Stronger deployment auth/OAuth verification** — Production-grade OAuth resource server with concrete verifier
6. **Workflow composition** — Multi-step task orchestration

### Prerequisites for real provider execution:

- Independent security review of credential boundaries and SSRF protection
- Durable persistence layer for audit/usage/replay durability
- Production deployment configuration (OAuth verifier, secrets management)
- Explicit feature gate `provider_execution_enabled: true` with clear documentation
- Cost monitoring and alerting for paid provider calls

### What MUST NOT be done yet:

- ❌ No real provider SDK integration
- ❌ No paid API calls
- ❌ No production credential storage in repository
- ❌ No bypass of budget/policy enforcement
- ❌ No merge to main branch
- ❌ No changes to authentication deployment boundary

### Recommended next step:

Architectural review to select the smallest logical next vertical slice based on dependencies and risk. Durable persistence is likely the highest-leverage prerequisite for production readiness.
