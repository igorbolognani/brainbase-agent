# Phase 0 Checkpoint: Toolchain Correctives Complete

**Commit**: Phase 0 A1-A5 correctives - reproducible toolchain green
**Date**: 2026-08-19
**Status**: PHASE 0 PARTIAL - Toolchain complete, substantive work remains

## ✅ COMPLETED (A1-A5): Reproducible Toolchain

### A1 & A2: Node Version and Dependencies

- ✅ Added `.nvmrc` pinning Node 20.18.0
- ✅ Updated `engines.node` to `>=20.18.0`
- ✅ Downgraded eslint tooling to compatible versions (eslint@9.17.0, typescript-eslint@8.17.0)
- ✅ `npm ci` exits 0 with NO EBADENGINE warnings
- ✅ `npm audit`: 0 vulnerabilities

### A3: Formatting

- ✅ `npm run format:check` exits 0
- ✅ All files use Prettier code style

### A4: Typecheck Without Prior Build

- ✅ Fixed TypeScript project references with paths mappings
- ✅ Made all packages composite with declaration/declarationMap
- ✅ Changed `moduleResolution` from `bundler` to `Node16`
- ✅ Updated all package typecheck scripts to `tsc --build --force`
- ✅ `npm run typecheck` exits 0 immediately after `npm ci`, NO dist required

### A5: Clean Build

- ✅ `rm -rf packages/*/dist packages/*/*.tsbuildinfo && npm run build` exits 0
- ✅ All packages build successfully from clean state

### Final Strict Verification (Partial A7)

```bash
cd /workspace/brainbase-agent
set -euo pipefail
npm ci                    # exits 0, no EBADENGINE
npm run format:check      # exits 0
npm run lint              # exits 0 (2 warnings acceptable)
npm run typecheck         # exits 0 without prior build
npm run test              # exits 0 (48 tests pass)
rm -rf packages/*/dist packages/*/*.tsbuildinfo
npm run build             # exits 0
npm audit                 # 0 vulnerabilities
```

**Result**: ✅ GREEN

---

## ⚠️ BLOCKERS REMAINING: Substantive Implementation Required

Phase 0 A6-A7 and B-G require significant implementation work that cannot be completed in a single pass. Each blocker below represents multiple work units.

### A6: Tests for New Packages (DEFERRED)

**Status**: mcp-server and planned UI package have no tests yet

**Required Work**:

1. mcp-server needs MCP transport/integration tests proving:
   - HTTP endpoint can initialize/list/call safe tools locally
   - No paid provider calls in tests
2. UI package (to be created in C) needs:
   - Component smoke tests
   - Navigation tests
   - route_task result projection tests

### B: MCP Server v2 Migration + HTTP Remote Endpoint (BLOCKED - MAJOR WORK)

**Status**: Current server uses v1 `@modelcontextprotocol/sdk` + StdioServerTransport

**Blockers**:

1. **Package migration**: v1 monolith → v2 split packages
   - `@modelcontextprotocol/sdk` → `@modelcontextprotocol/server` + `@modelcontextprotocol/core`
   - Currently: `packages/mcp-server/package.json` imports v1 SDK
2. **API migration**: Handler registration patterns changed
   - v1: `server.setRequestHandler(CallToolRequestSchema, handler)`
   - v2: `server.registerTool(name, { schema }, handler)`
   - All 4 tools need rewrite (list_models, route_task, get_task, get_usage)
3. **Transport migration**: Stdio → Streamable HTTP + optional stdio
   - v1: `StdioServerTransport` only (local process integration)
   - v2: Must implement `createMcpHandler` factory for remote HTTP `/mcp` endpoint
   - Stdio may be retained as dev adapter, not primary
4. **Current wording**: Code says "compatible with ChatGPT Plugins"
   - Must update to current terminology: "ChatGPT Apps SDK / MCP Apps"

**Authoritative Sources Fetched**:

- MCP v2 server README, HTTP serving guide, upgrade guide (all fetched above)
- Key changes: per-request factory, stateless handlers, Streamable HTTP, method strings

**Estimate**: 4-6 hours for proper migration following authoritative docs

### C: Real Apps SDK UI Package (BLOCKED - MAJOR WORK)

**Status**: No UI package exists; only backend contracts scaffolded

**Blockers**:

1. **Package creation**: New `packages/ui` workspace package required
2. **Apps SDK integration**: Must fetch and implement per OpenAI official docs:
   - https://developers.openai.com/apps-sdk/
   - Widget/resource registration patterns
   - MCP Apps bridge (preferred) or ChatGPT-specific compat APIs
3. **11 canonical surfaces** navigation:
   - Overview, Router, Tasks, Engineering, Models, Providers & Connections,
   - Model Gateways/Proxies, Usage & Budgets, Security & Permissions,
   - Activity/Audit, Settings
   - V0.1 functional subset: Overview, Router, Tasks, Providers & Connections,
     Model Gateways/Proxies, Engineering status shell
   - Others: honest placeholders
4. **Synthetic state projection**: UI projects canonical backend state
   - Mock data must be clearly labeled
   - No paid provider calls
   - Tests prove navigation + route_task result rendering

**Estimate**: 8-12 hours for proper implementation with OpenAI Apps SDK docs

### D: Routing Fail-Closed (BLOCKED - IMPLEMENTATION)

**Status**: Current RoutingEngine has placeholder fallbacks

**Blockers** (packages/domain/src/routing-engine.ts):

1. **Line 141-158**: `quality/latency/custom` strategies silently fall back to cost
   - Required: Reject with structured `ordering_strategy_unsupported` error
   - No silent fallback allowed
2. **Line 119**: `require_https` is NOT actually enforced
   - Placeholder check only
   - Must integrate with real gateway connection metadata
   - May require dependency boundary change
3. **Manual override validation**: Currently bypasses checks
   - Must pass same admissibility/security/budget checks as auto-routing
4. **Missing tests**: No test coverage for:
   - Unsupported ordering rejection
   - `require_https` enforcement with real connection data
   - Manual override policy checks

**Estimate**: 3-4 hours for proper fail-closed implementation + tests

### E: SSRF Protection at Dispatch Boundary (BLOCKED - IMPLEMENTATION)

**Status**: Current GatewayValidator is preflight-only (packages/security/src/gateway-validator.ts)

**Blockers**:

1. **Lines 37-65**: URL/DNS/IP validation happens at config time only
   - Required: Create safe outbound gateway request abstraction
   - HTTPS enforcement at actual dispatch
   - Parse/canonicalize IPv4/IPv6/mapped IPv6
   - Reject loopback/private/link-local/metadata/special-use
2. **TOCTOU protection**: Resolve/revalidate at actual dispatch
   - Prevent DNS rebind bypass
   - No validation/dispatch time gap
3. **Redirect handling**: Manual/controlled redirects only
   - Validate/re-resolve EVERY Location hop before dispatching
   - Enforce maxRedirects limit
   - Enforce timeout/AbortSignal
4. **Missing tests**:
   - Direct private target rejection
   - IPv6, mapped IPv6 rejection
   - Multiple DNS results handling
   - Public→private redirect rejection
   - Redirect limit enforcement
   - Timeout enforcement
   - Simulated DNS rebind scenario

**Estimate**: 4-6 hours for proper dispatch-boundary SSRF protection + tests

### F: Auth/Tenant/Secret Boundaries (BLOCKED - IMPLEMENTATION)

**Status**: Contracts define types, but no authorization service or runtime enforcement

**Blockers**:

1. **No authorization service**: Types exist (Principal, Account, AccountMembership)
   - Required: Actual authorization boundary checking principal/account mismatch
   - Tests proving denial on mismatch
2. **Secret exposure risk**: No runtime serialization sanitizer
   - `credential_reference`/vault paths must NOT reach MCP args/responses/logs
   - Required: Runtime redaction with tests using hostile secret-like fields
   - Test actual sanitizer/allowlist behavior, not just type comments
3. **Provider auth**: Dynamic catalog supports OAuth/secure setup in principle
   - Must verify raw secrets never in MCP messages/widget state/audit events
4. **Missing tests**:
   - Principal/account authorization denial
   - Secret serialization redaction
   - Audit event sanitization

**Estimate**: 3-4 hours for authorization service + secret boundaries + tests

### G: Doc/Claim Integrity (ONGOING)

**Status**: Docs must be updated after implementation to match actual state

**Required**:

- Remove claims for unimplemented features (KMS/AES/key rotation/etc.)
- Remove speculative timeout/redirect constants unless actually enforced
- Distinguish implemented / tested / mocked / deferred / unsupported
- Update after B-F are implemented

---

## Phase 1: Product Orchestration (NOT STARTED)

Per instructions, Phase 1 is ONLY to begin after Phase 0 is fully green.

**Scope**: Minimal internal orchestration for:

- `route -> budget gate -> execute adapter -> verify -> retry/fallback -> usage reconciliation -> audit`
- NO workflow designer, DAG canvas, generic automation studio
- Synthetic end-to-end flow with MockDirectProvider + MockGateway + MockExecutionAdapter + MockVerifier
- Failure tests: no route, budget denied, first fails then fallback succeeds, idempotent start, verifier failure, cancellation race

---

## Decision: Checkpoint and Report

Given:

1. Phase 0 A1-A5 are GREEN and verified
2. Phase 0 A6-B-C-D-E-F represent 25-35 hours of substantive implementation
3. Instruction: "If Phase 0 cannot be made green in this run, stop before Phase 1, push only a coherent corrective checkpoint if appropriate, and report the blocker truthfully"

**Action**: Commit toolchain fixes, document blockers truthfully, push checkpoint.

**Next Pass**: Continue with B (MCP v2 migration) using fetched authoritative sources, then C (Apps SDK UI), then D-F (security/routing hardening).
