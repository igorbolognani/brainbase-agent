# Verification Gates

Every implementation checkpoint must distinguish deterministic gates from architecture/security review.

## Deterministic CI gate

Run from a clean checkout with strict shell failure propagation:

```bash
set -euo pipefail
rm -rf packages/*/dist packages/*/*.tsbuildinfo
npm ci
npm run format:check
npm run lint
npm run typecheck
npm test
rm -rf packages/*/dist packages/*/*.tsbuildinfo
npm run build
npm audit --audit-level=high
```

Generated `dist/` and `*.tsbuildinfo` outputs must not be tracked.

## Targeted gates by phase

### Remote MCP
- local mode remains loopback-protected;
- remote mode refuses incomplete security configuration;
- disallowed Host/Origin rejected before MCP dispatch;
- missing/invalid bearer token rejected;
- initialize, tools/list, and safe tools/call proven over real HTTP;
- `route_task` proven no-spend.

### Gateway dispatch / SSRF
- HTTPS only;
- IPv4/IPv6/mapped address canonicalization;
- all DNS answers checked;
- private/loopback/link-local/metadata blocked;
- DNS re-resolution at dispatch;
- every redirect hop revalidated;
- timeout and redirect cap enforced.

### Auth / tenancy / secrets
- active membership required at account service boundary;
- suspended/revoked/cross-account denied;
- model-visible/MCP/log/audit serializers do not expose secrets or vault paths.

### UI / vertical slice
- canonical navigation renders;
- state comes from canonical backend projections;
- mocked/synthetic state is visibly identified;
- no paid provider call is required for tests.

## Review rule

A passing CI run does not prove architecture/security correctness. Each coherent checkpoint still requires diff/contract review before integration into `feat/gptrouter-v0-system-design`.
