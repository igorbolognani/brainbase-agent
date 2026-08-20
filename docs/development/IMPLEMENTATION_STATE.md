# Implementation State

Integration branch: `feat/gptrouter-v0-system-design`

Original verified baseline for this sequence: `20ea09a734269aa630650180831fc8c2b5b26d39`.

## Green

- Phase 0A verification truth restored.
- Deterministic GitHub Actions CI now enforces install, formatting, lint, typecheck, tests, clean build, audit, and generated-output hygiene.
- MCP TypeScript SDK v2 structure is shared by stdio and HTTP adapters.
- Phase 0B remote MCP transport boundary is implemented and CI-verified:
  - explicit local vs remote deployment modes;
  - local mode is loopback-only;
  - remote mode fails closed without explicit bind/Host/Origin/auth configuration;
  - Host and Origin are validated before MCP dispatch;
  - a bootstrap bearer boundary is enforced before MCP dispatch;
  - real HTTP tests prove initialize, tools/list, and route_task tools/call;
  - route_task remains planning-only with no provider execution or spend.
- Cost routing remains operational; unsupported quality/latency/custom ordering fails closed.

## Important authentication boundary

Phase 0B proves a secure deployment gate, not final ChatGPT user authentication. The static bearer boundary is temporary bootstrap infrastructure. Production OAuth/OIDC token verification, Principal -> AccountMembership -> Account authorization, and tenant isolation remain Phase 0E work and must follow current official MCP/OpenAI requirements.

## Current

Phase 0D — SSRF protection at the actual outbound gateway dispatch boundary.

## Canonical remaining order

1. Phase 0D — SSRF protection at actual outbound dispatch.
2. Phase 0E — runtime auth/tenancy/secrets.
3. Phase 0C — connection-metadata-aware HTTPS routing.
4. Phase 0F — Apps SDK/MCP UI.
5. Phase 0G — synthetic repository-backed vertical slice.
6. Phase 1 — minimal product orchestration.
7. Final clean verification and release-readiness review.

## Completion rule

Do not create `DEVELOPMENT_COMPLETE.md` until the full clean gate and the targeted MCP/security/UI/vertical-slice/orchestration checks are green with evidence.
