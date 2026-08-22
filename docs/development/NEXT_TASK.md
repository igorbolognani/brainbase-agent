# Next Task

## Phase 4-6 Corrective — COMPLETE

Branch `work/phase-4-6-corrective` based on scaffold checkpoint `509ba95`.

### What was corrected:

**Phase 4**: Evidence-based routing now integrated into production
- PricingStatus type for unknown pricing semantics
- Health as admissibility (disabled/unavailable excluded)
- Task-family quality scoring with fail-closed
- Capability evidence from ModelOffering
- Production wiring with getQualityScores/getHealthStates/getOffering
- Fixed estimateRouteCost

**Phase 5**: Orchestration now durable and bounded
- OrchestrationLimits enforced (max_nodes, max_parallel, max_stages, etc.)
- OrchestratorStore for persistence (not in-memory authority)
- True max_parallel enforcement
- Proper cancellation with cancel_requested state
- Graph deduplication via execution_id

**Phase 6**: Insecure REST API removed
- IDOR vulnerabilities eliminated
- MCP is canonical control plane
- Production throws on synthetic context

### Verification results:

- 400 tests passing (all packages)
- Format: clean
- Typecheck: clean
- Build: clean
- Prisma validate: clean
- Lint: 0 errors (pre-existing warnings only)
- No live provider calls
- No tracked generated artifacts

### Current test inventory:

| Package                     | Tests |
| --------------------------- | ----- |
| contracts                   | 6     |
| domain                      | 111   |
| mcp-server                  | 77    |
| persistence (unit)          | 56    |
| persistence (postgres-int)  | 46    |
| provider-runtime            | 27    |
| security                    | 77    |
| **Total**                   | **400** |

## Remaining work:

1. Wire OrchestrationGraphRepository into production composition
2. Prisma migration for limits JSON column
3. E2E tests for multimodal orchestration
4. MCP dashboard for models/providers/usage
5. Live provider integration tests (with feature flag)
6. Address Prisma upstream audit (deepmerge-ts)
