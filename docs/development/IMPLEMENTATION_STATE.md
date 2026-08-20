# Implementation State

Integration branch: `feat/gptrouter-v0-system-design`

Original verified baseline for this sequence: `20ea09a734269aa630650180831fc8c2b5b26d39`.

## Green

- Phase 0A verification truth restored.
- Deterministic GitHub Actions CI enforces install, formatting, lint, typecheck, tests, clean build, audit, and generated-output hygiene.
- MCP TypeScript SDK v2 structure is shared by stdio and HTTP adapters.
- Phase 0B remote MCP transport boundary is implemented and CI-verified.
- Phase 0D safe outbound gateway dispatch is implemented and CI-verified.
- Phase 0E runtime tenant, OAuth resource-server, and secret-output boundaries are implemented and CI-verified.
- Phase 0C connection-metadata-aware HTTPS routing is implemented and CI-verified.
- Phase 0F Plugin / MCP Apps UI is implemented and CI-verified on its work branch:
  - versioned `ui://gptrouter/dashboard-v1.html` resource;
  - MIME type `text/html;profile=mcp-app`;
  - dedicated `render_gptrouter_dashboard` render tool linked with `_meta.ui.resourceUri`;
  - `openai/outputTemplate` retained only as a compatibility alias;
  - stable MCP Apps `2026-01-26` view handshake with `appInfo`, `appCapabilities`, and `ui/notifications/initialized`;
  - complete 11-section GPTRouter navigation shell;
  - functional-shell priority for Overview, Router, Tasks, Engineering, Models, Providers & Connections, Model Gateways / Proxies, and Usage & Budgets;
  - Security & Permissions, Activity / Audit, and Settings remain placeholders;
  - structured and visible synthetic/no-spend state;
  - no external UI assets;
  - no `run_task`, provider execution, or paid calls.
- Phase 0G synthetic repository-backed vertical slice is implemented and CI-verified:
  - single authoritative `GPTRouterApplication` over in-memory synthetic repositories;
  - `list_models`, `route_task`, `get_task`, `get_usage`, and dashboard all read from the same shared application state;
  - `route_task` invokes the real `RoutingEngine` and persists planned tasks and routing decisions;
  - `get_task` in a separate MCP request retrieves the previous plan;
  - estimated/planned cost is tracked separately from actual cost; actual provider spend is zero;
  - no `run_task`, no execution adapters, no outbound provider/gateway dispatch, no paid calls;
  - secret-like values do not appear in public tool outputs;
  - workspace test resolution maps `@gptrouter/*` packages to source so `npm test` passes without pre-existing `dist`.
- Current full CI test inventory: 139 unique tests (contracts 6, domain 33, MCP server 35, security 65).
- Cost routing remains operational; unsupported quality/latency/custom ordering fails closed.

## Authentication deployment boundary

The repository provides the standards-shaped OAuth resource-server boundary and tenant authorization service. A deployment must still provide a concrete OAuth/OIDC access-token verifier configured for its chosen authorization server, including issuer/audience/resource validation as required by that verifier. GPTRouter does not issue access tokens and does not pass provider/gateway credentials through MCP.

## Platform terminology

Current OpenAI developer documentation describes installable ChatGPT/Codex extensions as **Plugins**. GPTRouter uses the open **MCP Apps** UI standard for custom MCP UI and keeps ChatGPT-specific compatibility metadata isolated from the portable UI contract.

## Current

Phase 1 — minimal product orchestration.

## Canonical remaining order

1. Phase 0G — synthetic repository-backed vertical slice (complete).
2. Phase 1 — minimal product orchestration.
3. Final clean verification and release-readiness review.

## Completion rule

Do not create `DEVELOPMENT_COMPLETE.md` until the full clean gate and the targeted MCP/security/UI/vertical-slice/orchestration checks are green with evidence.
