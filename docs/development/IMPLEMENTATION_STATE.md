# Implementation State

Integration branch: `feat/gptrouter-v0-system-design`

Original verified baseline for this sequence: `20ea09a734269aa630650180831fc8c2b5b26d39`.

## Green

- Phase 0A verification truth restored.
- Deterministic GitHub Actions CI enforces install, formatting, lint, typecheck, tests, clean build, audit, and generated-output hygiene.
- MCP TypeScript SDK v2 structure is shared by stdio and HTTP adapters.
- Phase 0B remote MCP transport boundary is implemented and CI-verified:
  - explicit local vs remote deployment modes;
  - local mode is loopback-only;
  - remote mode fails closed without explicit bind/Host/Origin/auth configuration;
  - Host and exact HTTPS Origin are validated before MCP dispatch;
  - a bootstrap bearer boundary is available for controlled deployment bring-up;
  - real HTTP tests prove initialize, tools/list, and route_task tools/call;
  - route_task remains planning-only with no provider execution or spend.
- Phase 0D safe outbound gateway dispatch is implemented and CI-verified:
  - HTTPS-only target URLs and no URL userinfo;
  - byte-aware IPv4/IPv6 safety classification, including IPv4-mapped IPv6;
  - all DNS answers are checked and any unsafe answer fails closed;
  - DNS is resolved again immediately before each outbound transport hop;
  - the default HTTPS transport pins socket lookup to a validated address while preserving the original hostname/SNI;
  - redirects are handled manually, every same-origin hop re-enters DNS validation, and cross-origin redirects fail closed in V0.1;
  - redirect count, total timeout, and response-size limits are enforced;
  - tests cover private/loopback/mapped addresses, mixed DNS answers, simulated rebinding, redirects, timeout, and a safe synthetic request.
- Phase 0E runtime tenant and secret boundaries are implemented and CI-verified:
  - Principal / AccountMembership repository contracts support server-side identity-to-tenant lookup;
  - AccountAuthorizationService requires active same-account membership and enforces role hierarchy;
  - missing, suspended, revoked, cross-account, wrong-principal, and insufficient-role access fail closed with a uniform public error;
  - explicit public connection projections omit credential references and account internals;
  - dynamic public-output serialization drops or redacts authorization headers, cookies, passwords, API/access/refresh tokens, credential references, vault paths, and other secret-bearing keys;
  - remote OAuth resource-server mode publishes protected-resource metadata, gates MCP calls through an injected OAuthTokenVerifier, enforces scopes, and passes only verified AuthInfo to the canonical MCP handler;
  - the Phase 0B static bearer remains explicitly a bootstrap alternative rather than final user authentication.
- Current full CI test inventory: 122 unique tests (contracts 6, domain 20, MCP server 31, security 65).
- Cost routing remains operational; unsupported quality/latency/custom ordering fails closed.

## Authentication deployment boundary

The repository now provides the standards-shaped OAuth resource-server boundary and tenant authorization service. A deployment must still provide a concrete OAuth/OIDC access-token verifier configured for its chosen authorization server, including issuer/audience/resource validation as required by that verifier. GPTRouter does not issue access tokens and does not pass provider/gateway credentials through MCP.

## Current

Phase 0C — connection-metadata-aware HTTPS routing.

## Canonical remaining order

1. Phase 0C — connection-metadata-aware HTTPS routing.
2. Phase 0F — Apps SDK/MCP UI.
3. Phase 0G — synthetic repository-backed vertical slice.
4. Phase 1 — minimal product orchestration.
5. Final clean verification and release-readiness review.

## Completion rule

Do not create `DEVELOPMENT_COMPLETE.md` until the full clean gate and the targeted MCP/security/UI/vertical-slice/orchestration checks are green with evidence.
