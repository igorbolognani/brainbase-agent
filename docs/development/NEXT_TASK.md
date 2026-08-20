# Next Task

## Phase 0G — Synthetic Repository-Backed Vertical Slice

Replace MCP handler-local hardcoded fixtures with one authoritative synthetic application state backed by repository abstractions, while keeping the entire slice no-spend.

### Required

- Keep `route_task` planning-only and do not add provider execution.
- Introduce a minimal application/service boundary that composes existing domain routing, budget checks, connection metadata, and repositories.
- Replace handler-local fake production model names/prices with clearly synthetic route/model fixtures and explicit synthetic provenance.
- Back `list_models`, `route_task`, `get_task`, and `get_usage` with the same authoritative synthetic repository state.
- Persist planned tasks and routing decisions in the synthetic repository so `get_task` can retrieve the result of a prior `route_task` call.
- Keep estimated cost separate from actual cost; actual provider spend remains zero.
- Keep account scoping explicit in repository/service APIs.
- Feed the UI from safe projections of the same application state rather than creating a second UI-owned store.
- Preserve all Phase 0B/0C/0D/0E/0F security and no-spend boundaries.

### Required end-to-end proof

Through the real MCP HTTP boundary:

1. `list_models` returns repository-backed synthetic routes;
2. `route_task` invokes the real RoutingEngine and creates a planning task;
3. `get_task` retrieves that planned task and routing decision;
4. `get_usage` reports zero actual spend and truthful synthetic/estimated state;
5. the dashboard render tool projects the same safe state;
6. no outbound provider/gateway execution adapter is invoked.

### Do not implement yet

- real paid provider execution;
- generic workflow/node editor;
- private/local gateway bridge;
- production database deployment;
- production usage reconciliation.

### Exit gate

Full deterministic CI plus a synthetic no-spend vertical-slice test must be green before Phase 1 minimal orchestration begins.
