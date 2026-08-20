# Next Task

## Phase 0C — Connection-Metadata-Aware HTTPS Routing

Replace the temporary blanket gateway rejection under `require_https` with a real admissibility check against the selected route's persisted connection metadata.

### Required

- Keep `route_task` planning-only and no-spend.
- Resolve each gateway route's `connection_id` to a `GatewayConnection` owned by the same account as the task/policy context.
- When `require_https` is enabled, accept a gateway route only when its resolved connection has a syntactically valid HTTPS `gateway_url` with no URL credentials.
- Fail closed when gateway connection metadata is missing, inactive, mismatched by type, or belongs to another account.
- Do not require gateway metadata for provider routes.
- Keep provider/gateway allow/block policies unchanged.
- Apply the exact same admissibility path to manual overrides; no bypass.
- Do not duplicate endpoint metadata onto `ModelRoute`; `connection_id` remains the reference to connection-owned configuration.
- Do not perform any outbound provider/gateway request as part of planning.

### Required tests

- HTTPS gateway accepted when `require_https` is enabled and same-account active metadata exists;
- HTTP gateway rejected;
- URL userinfo rejected;
- missing connection rejected;
- wrong connection type rejected;
- revoked/expired/error connection rejected;
- cross-account connection rejected;
- provider route remains admissible without gateway metadata;
- manual override follows the same HTTPS/connection checks;
- planning never invokes an execution/outbound adapter.

### Do not implement yet

- Paid provider execution.
- Apps SDK UI.
- Generic workflow builder.

### Exit gate

Full deterministic CI plus targeted connection-aware routing tests must be green before Phase 0F UI work.
