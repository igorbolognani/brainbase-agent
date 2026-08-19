# AGENTS.md

Agents operating in this repository must:

- Understand before changing: inspect relevant structure, conventions, and history before editing.
- Make the smallest adequate change: prefer local, reversible edits over broad rewrites.
- Preserve contracts: treat public interfaces, schemas, and externally observable behavior as constraints unless explicitly authorized to change them.
- Verify work: run relevant checks and confirm behavior rather than assuming correctness.
- Inspect the final diff: review changes for accidental edits, regressions, or scope creep before completing a task.
- Never perform destructive Git actions (force push, history rewrite, hard reset, branch deletion, etc.) unless explicitly authorized.

## GPTRouter-Specific Guidance

Agents implementing GPTRouter must follow these additional principles:

### Architecture & Design
- Optimize for lowest-cost adequate capability, correctness, simplicity, maintainability, evidence, and reversibility.
- Treat architecture, contracts, security boundaries, persisted data, public interfaces, and Git history as constraints.
- Understand before changing: read relevant code, docs, and history.
- Use the smallest adequate change that satisfies requirements.
- Prefer a coherent vertical slice over broad unfinished scaffolding.

### Security
- NEVER expose, log, echo, print, or include raw provider API keys/tokens in model-visible contexts, MCP args, ChatGPT messages, tool transcripts, logs, or MCP responses.
- Credentials are captured server-side through secure OAuth/OIDC flows or encrypted storage; MCP only exposes connection initiation/status/revocation.
- Return opaque connection IDs/status only; never vault paths or credential material.
- Implement SSRF protection for user-configurable gateway URLs: HTTPS required, DNS/IP validation, block loopback/private/link-local/cloud-metadata.
- Structured logging with allowlist + central redaction defense-in-depth; never rely solely on regex for secret safety.

### Domain Model
- ProviderConnection and GatewayConnection are separate first-class concepts.
- ModelRoute includes route_type, route identity, source identity, connection identity; same model may have multiple routes.
- Remove speculative constants and hardcoded production model names/prices from domain code.
- Dynamic model metadata includes provenance/source, effective_at, refreshed_at, version.
- Pricing estimates are version-aware and not canonical truth.

### Routing & Execution
- `route_task`/planning MUST NOT spend money; `run_task`/execution is consequential.
- Two-stage routing: (1) capability/admissibility filter (requirements, availability, policy, budget/security), (2) order adequate routes by cost/quality/latency policy.
- Manual override requires validation against route/availability/policy/budget/capability.
- Return structured evidence/reason codes for routing decisions.
- Server-side budget/quota enforcement before dispatch: free_only, max cost/task, daily/monthly caps, allowed route classes.
- estimated_cost != actual_cost; actual cost from reconciled UsageRecord/provider evidence.

### Data & Provenance
- Explicit idempotency keys/replay semantics for all consequential operations.
- Cancellation is best-effort: cancel_requested != provider-confirmed cancelled; completion may win the race.
- RoutingDecision/Execution preserve route snapshot: route_id, route_type, connection/source identity, pricing metadata version, policy version.
- Persist execution-attempt and retry-policy provenance.

### Testing & Verification
- Risk-based tests: no arbitrary global coverage percentages.
- REQUIRE tests for: routing admissibility, budget/idempotency, tenant isolation, secrets boundary, SSRF gateway validation, cancellation races, contract validation.
- Tests use synthetic fixtures; no hardcoded historical production model names/prices.
- Reproducible verification from clean install/lockfile: format check, lint, typecheck, unit/contract tests, build.

### Development Workflow
- Security, testing, observability, and documentation are cross-cutting requirements, not final cleanup.
- Commit the package lockfile.
- Use currently maintained dependency/tooling versions; run audit and address vulnerabilities where practical.
- ADRs must record rationale/tradeoffs/reversibility; avoid claiming vendor products are free or permanent truths.
- Never push or merge directly to main; work on feature branches.
- Before committing: inspect `git status`, `git diff`, and `git log --oneline -10`; stage only intended files.
