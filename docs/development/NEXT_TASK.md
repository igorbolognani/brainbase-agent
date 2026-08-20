# Next Task

## Phase 0D — Safe Gateway Dispatch / SSRF Boundary

Implement the actual outbound HTTP request abstraction for user-configured gateway calls. The existing `GatewayValidator` is preflight-only and is not sufficient at dispatch time.

### Required

- HTTPS only.
- Parse and canonicalize IPv4, IPv6, and IPv4-mapped IPv6 safely.
- Resolve all DNS answers and reject the target if any answer is loopback, private, link-local, multicast/reserved as applicable, or cloud-metadata sensitive.
- Re-resolve and revalidate immediately at dispatch to reduce DNS rebinding / TOCTOU exposure.
- Own redirect handling explicitly; do not rely on automatic redirects.
- Revalidate every redirect target before following it.
- Enforce a small redirect cap.
- Enforce a total timeout with AbortSignal/AbortController.
- Do not forward credentials across an origin change unless a later explicit policy permits it; V0.1 should fail closed.
- Return structured safe errors without leaking credentials or internal addresses unnecessarily.

### Required tests

- direct loopback/private target rejected;
- unsafe IPv6 and IPv4-mapped IPv6 rejected;
- mixed DNS answers fail closed when any answer is unsafe;
- simulated public-to-private redirect rejected;
- redirect limit enforced;
- timeout aborts request;
- simulated re-resolution/rebinding from public to private rejected before dispatch;
- safe synthetic public request path succeeds without calling a paid provider.

### Do not implement yet

- Real paid provider execution.
- Private/local network bridge.
- Final tenant authorization or Apps SDK UI.

### Exit gate

The full deterministic CI gate plus targeted SSRF/dispatch tests must be green before moving to Phase 0E.
