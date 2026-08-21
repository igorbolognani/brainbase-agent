# Next Task

## Phase 2/3 — CORRECTIVE CHECKPOINT COMPLETE

Production persistence and provider execution have been corrected and verified locally:

### Corrected in this checkpoint:

1. **Persistence**: PostgreSQL + Prisma as canonical production target; SQLite/Drizzle retained as dev/test adapter
2. **Authentication**: jose-based cryptographic JWT signature verification with injectable JWKS
3. **Credential boundary**: `_credential` removed from `ProviderExecutionRequest`; `CredentialResolver` interface added
4. **Provider adapters**: API key in header (not URL), normalized output (no raw response blob), null cost for unknown
5. **Error taxonomy**: Added context_limit, insufficient_balance, credential_missing, credential_revoked
6. **Cost semantics**: `actual_cost: number | null` where null = unknown, 0 = known zero
7. **Provider health**: Wired into routing admissibility via `getConnectionHealth`
8. **Runtime factory**: Production adapter registration path with `credentialResolver` dependency
9. **Prisma schema**: PostgreSQL provider, JSONB for complex fields, distinct ProviderConnection/GatewayConnection tables

### Test results:

- 277 tests passing (contracts 6, domain 88, mcp-server 77, persistence 41, security 65)
- Full clean gate verified locally: format:check, lint (0 errors), typecheck, test, build, audit (0 vulnerabilities)

### What this checkpoint does NOT include:

- No PostgreSQL integration test (requires external DB)
- No live provider calls
- No Phase 4 work
- No merge to main

## NEXT PHASE — Phase 4: Intelligent Routing (NOT STARTED)

Phase 4 has NOT been started. The local branch contains an unpushed Phase 4 commit
(`feat(phase4): evidence based intelligent routing`) that was created BEFORE this
corrective review. It is preserved on `checkpoint/pre-phase23-corrective` and the
local HEAD for safety, but is NOT part of this corrective checkpoint.

### Remaining blockers before Phase 4:

1. PostgreSQL integration test infrastructure
2. Production deployment configuration for OAuth verifier and secrets
3. Independent security review of credential boundaries
4. Cost monitoring and alerting for paid provider calls
5. Production feature flag enforcement verification

### What MUST NOT be done until Phase 4 authorization:

- No intelligent routing implementation
- No multi-model orchestration
- No control-plane expansion
- No merge to main
