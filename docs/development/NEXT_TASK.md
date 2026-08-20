# Next Task

## Phase 0E — Runtime Auth / Tenancy / Secret Boundaries

Turn the existing Principal / AccountMembership / Account types into enforceable runtime service boundaries and ensure model-visible, MCP, log, and audit outputs cannot leak credentials or internal vault references.

### Required

- Keep app authentication separate from provider/gateway credentials.
- Add a runtime authorization service that resolves a Principal to an active AccountMembership for the requested Account.
- Deny missing, suspended, revoked, or cross-account membership.
- Support role requirements without trusting client-supplied account ownership claims.
- Add explicit safe projection/serialization helpers for model-visible/MCP/log/audit data.
- Do not expose raw API keys, bearer tokens, passwords, secret values, Authorization/Cookie headers, or internal credential/vault paths.
- Where a public response needs connection identity, expose opaque connection ID plus safe status/metadata only.
- Keep the Phase 0B static bearer gate labeled as bootstrap transport protection; do not falsely present it as final user auth.
- Preserve provider auth extensibility: OAuth and secure server-side secret setup are both valid provider connection methods.

### Required tests

- active same-account membership succeeds;
- cross-account access denied;
- suspended/revoked membership denied;
- insufficient role denied;
- hostile nested secret-like fixtures are redacted or rejected at each public projection boundary;
- credential references/vault paths do not reach model-visible/MCP projections;
- authorization failures do not leak whether a foreign account/resource exists.

### Do not implement yet

- Paid provider execution.
- Apps SDK UI.
- Generic workflow builder.

### Exit gate

Full deterministic CI plus targeted authorization/secret-boundary tests must be green before Phase 0C routing/HTTPS completion.
