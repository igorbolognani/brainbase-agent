# Next Task

## Phase 0F — Plugin / MCP Apps UI

Finish and verify the first real GPTRouter custom UI using the current OpenAI plugin + MCP Apps architecture.

### Required

- Keep existing MCP data tools useful without UI.
- Expose a versioned MCP Apps resource with MIME type `text/html;profile=mcp-app`.
- Associate only the dedicated render tool with `_meta.ui.resourceUri`.
- Use the portable `ui/*` JSON-RPC bridge as the primary UI-host contract.
- Keep `openai/outputTemplate` only as a compatibility alias.
- Render the complete GPTRouter navigation shell.
- Clearly mark synthetic/no-spend state and placeholder pages.
- Keep `route_task` planning-only; do not add `run_task` or provider execution.
- Load no external UI assets in this first shell.

### Required tests

- real HTTP `resources/list` includes the GPTRouter UI resource;
- real HTTP `resources/read` returns the MCP Apps MIME type and UI document;
- `tools/list` includes the render tool and still excludes `run_task`;
- render tool returns complete structured navigation and synthetic/no-spend safety state;
- full deterministic CI is green.

### Do not implement yet

- paid provider execution;
- durable product repositories;
- generic workflow builder;
- production usage ledger.

### Exit gate

After the UI resource/tool and tests are green, advance to Phase 0G synthetic repository-backed vertical slice.
