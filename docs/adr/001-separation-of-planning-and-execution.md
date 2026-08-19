# ADR 001: Separation of Planning and Execution

## Status
Accepted

## Context
GPTRouter needs to route AI tasks to cost-effective models. However, the routing decision process itself could inadvertently spend money if not carefully designed. Users need to understand costs before committing to execution.

## Decision
We separate routing into two distinct phases:

1. **Planning Phase** (`route_task`): Analyzes requirements, evaluates routes, returns routing decision with estimated cost. MUST NOT spend any money or execute consequential actions.

2. **Execution Phase** (`run_task`): Takes an approved routing decision and executes the task. This is the only phase that spends money and requires idempotency protection.

## Rationale

### Safety
- Users can review estimated costs before committing
- No accidental spending during route exploration
- Budget enforcement can happen at execution boundary

### Transparency
- Clear separation makes cost implications obvious
- Routing decisions can be audited without financial impact
- Users can experiment with different policies safely

### Correctness
- Immutable routing decisions provide audit trail
- Execution provenance links back to specific planning decision
- Re-planning without re-execution is possible

## Consequences

### Positive
- Users have explicit approval point before spending
- Route planning can be called repeatedly at zero cost
- Clear contract: planning is free, execution is consequential
- Supports "dry run" workflows

### Negative
- Two-step workflow instead of one
- Routing decisions may become stale (model availability changes)
- Need to handle: user approves plan, but execution fails due to changed conditions

### Mitigations
- Cache routing decisions for short TTL (5 minutes)
- Re-validate route availability at execution time
- Return clear error if route no longer available, with option to re-plan

## Alternatives Considered

### Single-Step Execution
Combine planning and execution into one call. Rejected because:
- No opportunity for user review
- Budget enforcement would need to happen speculatively
- Accidental re-tries could spend money

### Auto-Execute Below Threshold
Plan and auto-execute if cost < threshold, otherwise require approval. Rejected because:
- Inconsistent UX
- Hidden behavior is prone to surprises
- Still need two-phase architecture underneath

## Reversibility
**High**. Can add convenience wrappers that combine both phases for trusted scenarios, while keeping the underlying separation intact.
