# GPTRouter V0.1 Scope

## Goal

Deliver one unified GPTRouter App whose ChatGPT-facing UI is backed by a secure MCP boundary and a deterministic routing core. The first release proves safe planning, observability, and a synthetic end-to-end path before any paid provider execution is enabled.

## In scope

1. Remote MCP boundary suitable for controlled deployment.
2. Safe outbound gateway dispatch with SSRF protections.
3. Runtime authentication, tenant authorization, and secret-output boundaries.
4. Connection-aware HTTPS routing policy enforcement.
5. One Apps SDK/MCP UI with the canonical navigation surfaces.
6. Synthetic repository-backed vertical slice with no provider spend.
7. Minimal internal orchestration: route -> budget -> mock execute -> verify -> retry/fallback -> usage -> audit.
8. Deterministic CI gates on every work/integration branch.

## Out of scope for V0.1

- Generic workflow/DAG builder.
- Arbitrary automation studio.
- Private-network/local gateway bridge.
- Production paid-provider execution before the synthetic slice is green.
- Evidence-free quality/latency ranking.
- Silent fallback from unsupported ordering strategies.
- Direct pushes or merges to main as part of implementation work.

## Canonical principle

Lowest-cost adequate capability. Capability/security/budget admissibility comes first; ordering happens only among admissible routes. Unsupported ordering fails closed.
