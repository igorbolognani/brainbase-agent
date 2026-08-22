# GPTRouter Implementation State

**Last updated**: Phase 4-6 corrective checkpoint (`ebdd25c`)

## Phase 1: Synthetic Execution Foundation

**Status**: ACCEPTED

- Synthetic routing engine (cost-based ordering)
- Synthetic execution boundary (no real provider calls)
- Retry/fallback with deterministic outcomes
- MCP server with stdio and HTTP transport
- V0.1 end-to-end synthetic flow

## Phase 2: Durable Production Foundation

**Status**: ACCEPTED

- PostgreSQL + Prisma as canonical production persistence
- SQLite/Drizzle retained as deterministic test/dev adapter
- Atomic idempotency via root Execution record with `UNIQUE(account_id, idempotency_key)`
- ExecutionAttempt linked to Execution via execution_id (retries/fallbacks create child attempts)
- CAS state transitions for Task and ExecutionAttempt
- RoutingDecision immutability
- Account isolation enforced at repository level
- Durable usage and audit contracts
- jose-based cryptographic JWT signature verification
- Injectable JWKS resolution for multi-issuer support

## Phase 3: Real Provider Execution Adapters

**Status**: ACCEPTED

- OpenAI-compatible adapter (OpenRouter, DeepSeek, etc.)
- Native Gemini adapter
- CredentialResolver interface for server-side credential resolution
- Credentials NEVER in domain request objects (opaque connection_id only)
- Known cost pricing with explicit `actual_cost: number | null`
- Unknown cost returns null (NOT zero)
- Error taxonomy with structured error codes
- AbortController-based HTTP cancellation
- Provider health tracking

## Phase 4: Evidence-Based Intelligent Routing

**Status**: ACCEPTED (corrective)

- ModelOffering catalog with capabilities, pricing, health state
- ModelQualityEvidence with benchmark ingestion
- PricingStatus type: `known_free | known_paid | unknown`
- Cost strategy fails closed on unknown pricing
- Quality strategy with task-family evidence (coding/reasoning/vision/general)
- Balanced strategy with cost + quality + health penalty
- Health as admissibility: disabled/unavailable connections excluded
- Capability evidence from ModelOffering overrides route strings
- Unknown capability fails closed
- Production wiring: getQualityScores, getHealthStates, getOffering deps
- Structured routing explanation

## Phase 5: Bounded Multi-Model Orchestration

**Status**: ACCEPTED (corrective)

- OrchestrationLimits with enforced bounds (max_nodes, max_parallel, max_stages, etc.)
- OrchestrationGraphBuilder produces serializable graph structures
- OrchestrationOrchestrator with OrchestratorStore for durable state
- True max_parallel enforcement (never exceeds limit)
- Cancellation: cancel_requested -> pending cancelled -> final state
- Graph deduplication via execution_id idempotency
- Fallback sequential semantics (primary -> secondary only if needed)
- Planner/Worker/Reviewer staged execution

## Phase 6: Control Plane

**Status**: ACCEPTED (corrective)

- MCP Apps is canonical control plane surface
- Insecure REST API removed (IDOR vulnerabilities, no auth, synthetic context)
- Production application throws on synthetic context
- Auth required when OAuth configured (requireAuthenticatedAccount)
- All mutations require verified identity via authorizeVerifiedIdentity

## Test Inventory

| Package                     | Tests | Status  |
| --------------------------- | ----- | ------- |
| contracts                   | 6     | Passing |
| domain                      | 111   | Passing |
| mcp-server                  | 77    | Passing |
| persistence (unit)          | 56    | Passing |
| persistence (postgres-int)  | 46    | Passing |
| provider-runtime            | 27    | Passing |
| security                    | 77    | Passing |
| **Total**                   | **400** | **All passing** |

## PostgreSQL Integration Test Status

POSTGRES INTEGRATION: REQUIRES DOCKER (test starts own container)

- Prisma migrations applied
- All repository CRUD operations verified
- Account isolation verified
- Root idempotency verified

## Security Properties

- JWT signature verification via jose (RS256, injectable JWKS)
- Raw credentials never in domain objects, URLs, logs, or audit
- SSRF-safe gateway dispatch via SafeGatewayDispatcher (HTTPS enforced)
- Account-scoped authorization enforced
- Provider health keyed by connection_id for account isolation
- No synthetic context in production application
- Unknown pricing fails closed (not zero)
- Unknown capability fails closed
- No in-memory authoritative graphs (durable via OrchestratorStore)
- REST API removed (redundant attack surface)

## Architecture Decisions

- ADR 001: Separation of planning and execution
- ADR 002: No hardcoded model data
- ADR 003: Provider and Gateway as distinct connection types
- ADR 004: MCP is canonical control plane (REST API removed)
- ADR 005: PricingStatus for unknown pricing semantics
- ADR 006: OrchestrationLimits for bounded multi-model execution

## Remaining Limitations

- Provider execution disabled by default (feature flag)
- No live provider calls in test suite
- Provider pricing is reference-only (not canonical truth)
- Cancellation is best-effort (HTTP abort only, no provider-side cancel)
- Prisma dependency audit: 3 high (deepmerge-ts in prisma upstream)
- Orchestration graph state not yet wired to PrismaOrchestrationGraphRepository in production composition
- Task-family evidence routing uses simple keyword matching, not ML classification
