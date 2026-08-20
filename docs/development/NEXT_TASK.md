# Next Task

## Phase 0F — Apps SDK / MCP UI

Add the first real GPTRouter app surface inside ChatGPT using the current OpenAI Apps SDK / MCP app resource pattern. The UI is a projection and control surface over canonical GPTRouter state; it must not become a second authoritative store.

### Required

- Verify the current official OpenAI Apps SDK documentation before implementation and use its current MCP resource/tool metadata conventions.
- Keep one GPTRouter App with one coherent navigation model.
- Add an actual widget/UI package or equivalent buildable UI module and integrate its resource with the MCP server.
- Include all canonical navigation items: Overview, Router, Tasks, Engineering, Models, Providers & Connections, Model Gateways / Proxies, Usage & Budgets, Security & Permissions, Activity / Audit, Settings.
- Make Overview, Router, Tasks, Providers & Connections, Model Gateways / Proxies, and a compact Engineering shell useful in the first slice.
- Remaining pages may be truthful placeholders but must be clearly labeled as not yet implemented.
- Render only canonical/safe DTO projections; do not expose credential references, vault paths, bearer tokens, raw provider keys, account internals, or unsafe gateway URL details.
- Use clearly labeled synthetic/local fixture state until Phase 0G repository-backed data is wired.
- Project `route_task` planning results into the UI without executing or spending provider money.
- Preserve chat as the main interaction surface; the widget is state/control/observability rather than a generic workflow builder.
- Keep the Engineering page executor-agnostic. Do not recreate OpenCode/Codex/Brainbase UI.
- No paid provider calls.

### Required tests

- all canonical navigation entries render;
- functional priority pages render their expected safe projections;
- placeholders are visibly labeled;
- synthetic/mock state is visibly labeled;
- UI resource metadata and tool-to-widget linkage match current official Apps SDK conventions;
- `route_task` structured output can be projected without a second authoritative state model;
- hostile secret-like fixture values do not appear in rendered/public UI output;
- no provider execution adapter is invoked by UI smoke tests.

### Do not implement yet

- Real paid provider execution.
- Generic workflow/node editor.
- Private/local gateway bridge.
- Full Phase 1 orchestration.

### Exit gate

Full deterministic CI plus UI/resource/navigation/secret-boundary smoke tests must be green before Phase 0G repository-backed vertical-slice work.
