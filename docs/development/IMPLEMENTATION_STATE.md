# GPTRouter Implementation State

**Last updated**: Phase 2/3 corrective checkpoint

## Phase 1: Synthetic Execution Foundation

**Status**: Complete and verified

- Synthetic routing engine (cost-based ordering)
- Synthetic execution boundary (no real provider calls)
- Retry/fallback with deterministic outcomes
- MCP server with stdio and HTTP transport
- V0.1 end-to-end synthetic flow

## Phase 2: Durable Production Foundation

**Status**: Corrected and locally verified

- PostgreSQL as canonical production persistence (Prisma schema)
- SQLite/Drizzle retained as dev/test adapter
- Atomic idempotency via `account_id + idempotency_key` unique constraint
- CAS state transitions for Task and ExecutionAttempt
- RoutingDecision immutability
- Account isolation enforced at repository level
- Durable usage and audit contracts
- jose-based cryptographic JWT signature verification
- Injectable JWKS resolution for multi-issuer support

## Phase 3: Real Provider Execution Adapters

**Status**: Corrected and locally verified

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
- Provider health tracking wired into routing admissibility
- Production runtime factory with real adapter registration path

## Current Test Inventory

| Package     | Tests   | Status          |
| ----------- | ------- | --------------- |
| contracts   | 6       | Passing         |
| domain      | 88      | Passing         |
| mcp-server  | 77      | Passing         |
| persistence | 41      | Passing         |
| security    | 65      | Passing         |
| **Total**   | **277** | **All passing** |

## Architecture Decisions

- ADR 001: Separation of planning and execution
- ADR 002: No hardcoded model data
- ADR 003: Provider and Gateway as distinct connection types

## PostgreSQL Integration Test Status

POSTGRES INTEGRATION TEST: NOT RUN

Reason: No test PostgreSQL instance available. Drizzle/SQLite used for repository tests.
Production schema (Prisma) is statically validated. Runtime integration requires
a PostgreSQL instance.

## Security Properties

- JWT signature verification via jose (RS256, injectable JWKS)
- Raw credentials never in domain objects, URLs, logs, or audit
- ProviderConnection and GatewayConnection as distinct types
- SSRF-safe gateway dispatch via SafeGatewayDispatcher
- Account-scoped authorization enforced
- Provider health keyed by connection_id for account isolation

## Remaining Limitations

- Provider execution disabled by default (feature flag)
- No live provider calls in test suite
- No PostgreSQL integration test (requires external DB)
- Provider pricing is reference-only (not canonical truth)
- Cancellation is best-effort (HTTP abort only, no provider-side cancel)
- No Phase 4 work has started
