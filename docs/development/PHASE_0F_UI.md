# Phase 0F — Plugin / MCP Apps UI

Phase 0F follows the current OpenAI plugin architecture rather than the older Apps SDK-first wording.

## Current platform terminology

OpenAI's current developer documentation describes installable extensions as **Plugins**. A plugin can contain skills, an MCP server, or both; an MCP server may optionally return UI resources.

For new custom UI, ChatGPT implements the open **MCP Apps** standard. The portable path is:

1. expose an MCP UI resource with MIME type `text/html;profile=mcp-app`;
2. associate only render tools with `_meta.ui.resourceUri`;
3. use the `ui/*` JSON-RPC bridge over `postMessage` as the primary host contract;
4. keep data/business tools useful without UI;
5. use `window.openai` only as a compatibility layer or for ChatGPT-specific extensions.

The `openai/outputTemplate` metadata alias remains present only for compatibility.

## GPTRouter Phase 0F scope

The first GPTRouter UI is a real MCP Apps resource, but its product data is intentionally synthetic/no-spend until Phase 0G.

The navigation shell contains:

- Overview;
- Router;
- Tasks;
- Engineering;
- Models;
- Providers & Connections;
- Model Gateways / Proxies;
- Usage & Budgets;
- Security & Permissions;
- Activity / Audit;
- Settings.

The functional-shell priority is Overview, Router, Tasks, Engineering, Providers & Connections, and Model Gateways / Proxies. Remaining sections are explicitly labeled placeholders rather than pretending backend persistence exists.

## Safety boundary

- `route_task` remains planning-only;
- there is no `run_task` tool;
- provider execution and paid calls are disabled;
- the UI loads no external assets and declares empty MCP Apps CSP domain allowlists;
- navigation is local presentation state and does not mutate authoritative business state;
- the UI marks fixture state as synthetic in both structured output and visible copy.

## Exit gate

Phase 0F is green only when the resource is available through real Streamable HTTP, the render tool returns structured content with the complete navigation, deterministic CI is green, and the existing planning/no-spend guarantees remain intact.
