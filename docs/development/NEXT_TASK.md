# Next Task

## Phase 0B — Remote MCP Boundary

Implement and verify a secure, explicit split between local development and remote deployment for the MCP HTTP server.

### Required

- Keep MCP TypeScript SDK v2.
- Preserve stdio/local development.
- Remote mode must fail closed unless bind host, allowed hosts, allowed origins, and an authentication secret are explicitly configured.
- Validate Host and Origin before MCP dispatch.
- Require bearer authentication before MCP dispatch.
- Never log or return the configured bearer secret.
- Keep `route_task` planning-only and no-spend.
- Add tests for configuration and request-boundary rejection.
- Add protocol-level HTTP integration tests before Phase 0B is declared complete.

### Do not implement yet

- Provider execution.
- Generic workflows.
- Later SSRF dispatch, tenant service, or UI phases except for interfaces strictly needed by this boundary.

### Exit gate

`npm ci`, `format:check`, `lint`, `typecheck`, tests, clean build, and audit must be green in CI. Phase 0B remains PARTIAL until actual HTTP initialize/tools/list/tools/call integration is proven.
