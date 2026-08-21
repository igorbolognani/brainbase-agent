# GPTRouter Implementation State

**Last updated**: Phase 2/3 corrective checkpoint (clean branch)

## Phase 1: Synthetic Execution Foundation

**Status**: Complete and verified

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
- Prisma schema validated and generated

## Phase 3: Real Provider Execution Adapters

**Status**: ACCEPTED

- OpenAI-compatible adapter (OpenRouter, DeepSeek, etc.)
- Native Gemini adapter
- CredentialResolver interface for server-side credential resolution
- Credentials NEVER in domain request objects (opaque connection_id only)
- Gemini API key via x-goog-api-key header (NOT URL query parameter)
- Normalized output without raw provider response blobs
- Known cost pricing with explicit `actual_cost: number | null`
- Unknown cost returns null (NOT zero)
- Error taxonomy: rate_limited, timeout, provider_unavailable, invalid_request, authentication_failed, authorization_failed, context_limit, insufficient_balance, cancelled, credential_missing, credential_revoked, unknown_provider_error
- AbortController-based HTTP cancellation in adapters
- Provider health tracking
- Production runtime factory with real adapter registration path
- Trusted provider endpoint registry

## Phase 4: NOT STARTED

**Status**: NOT PRESENT ON THIS BRANCH

No Phase 4 commits, features, or code exist on this clean branch.

## Current Test Inventory

| Package                            | Tests   | Status          |
| ---------------------------------- | ------- | --------------- |
| contracts                          | 6       | Passing         |
| domain                             | 67      | Passing         |
| mcp-server                         | 77      | Passing         |
| persistence (unit)                 | 38      | Passing         |
| persistence (postgres integration) | 10      | Passing         |
| provider-runtime                   | 5       | Passing         |
| security                           | 65      | Passing         |
| **Total**                          | **268** | **All passing** |

## PostgreSQL Integration Test Status

POSTGRES INTEGRATION TEST: RUN

- Docker PostgreSQL 16 container started and tested
- Prisma migrations applied
- All repository CRUD operations verified
- Account isolation verified
- Root idempotency verified
- Retry/fallback child attempts verified
- Null actual_cost verified

## Architecture Decisions

- ADR 001: Separation of planning and execution
- ADR 002: No hardcoded model data
- ADR 003: Provider and Gateway as distinct connection types

## Security Properties

- JWT signature verification via jose (RS256, injectable JWKS)
- Raw credentials never in domain objects, URLs, logs, or audit
- ProviderConnection and GatewayConnection as distinct Prisma models
- SSRF-safe gateway dispatch via SafeGatewayDispatcher
- Account-scoped authorization enforced
- Provider health keyed by connection_id for account isolation

## Remaining Limitations

- Provider execution disabled by default (feature flag)
- No live provider calls in test suite
- Provider pricing is reference-only (not canonical truth)
- Cancellation is best-effort (HTTP abort only, no provider-side cancel)
- No Phase 4 work has started
