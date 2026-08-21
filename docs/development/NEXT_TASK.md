# Next Task

## Phase 2/3 — CORRECTIVE CHECKPOINT COMPLETE

Clean branch `work/phase-2-3-production-clean` based on Phase 3 baseline (`8fdc699`).
No Phase 4 code present.

### What was corrected:

1. **Persistence**: PostgreSQL + Prisma as canonical production target
   - Prisma schema with JSONB, distinct ProviderConnection/GatewayConnection, Execution record
   - `prisma validate` and `prisma generate` pass
   - SQLite/Drizzle retained as test/dev adapter

2. **Execution model**: Root Execution record with idempotency
   - `UNIQUE(account_id, idempotency_key)` on Execution (not ExecutionAttempt)
   - ExecutionAttempt linked via execution_id for retry/fallback

3. **Authentication**: jose-based JWT verification
   - Moved to `@gptrouter/security` package
   - Real cryptographic signature verification
   - Injectable JWKS resolution

4. **Provider runtime separation**: `@gptrouter/provider-runtime` package
   - Trusted provider endpoint registry
   - CredentialResolver wiring
   - Adapters remain in domain (re-exported by provider-runtime)

5. **Credential boundary**: CredentialResolver interface
   - Removed `_credential` from ProviderExecutionRequest
   - Removed `gateway_url` from ProviderExecutionRequest
   - Server-side credential resolution only

6. **Cost semantics**: `actual_cost: number | null`
   - null = unknown cost, 0 = known zero cost

7. **PostgreSQL integration tests**: 10 tests via Docker

### Test results:

- 268 tests passing (all packages)
- Full clean gate verified locally
- Prisma validate and generate pass
- PostgreSQL integration tests pass

### What this checkpoint does NOT include:

- No Phase 4 work
- No live provider calls
- No merge to main

## NEXT PHASE — Phase 4: Intelligent Routing (NOT STARTED)

Phase 4 has NOT been started. The existing commits `4692f34` (feat(phase4)) exist on
the old branch `work/phase-2-productionization` for later reapplication and review,
but are NOT part of this clean branch.

### Potential Phase 4 candidates:

1. Evidence-based routing (quality/latency ordering)
2. Model catalog with dynamic pricing
3. Benchmark ingester for quality metrics
4. Performance metadata collection
5. Balanced routing strategy
