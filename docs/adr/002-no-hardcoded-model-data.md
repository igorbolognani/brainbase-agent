# ADR 002: No Hardcoded Model Data in Domain Code

## Status
Accepted

## Context
Model capabilities and pricing change frequently. Hardcoding model names, capabilities, or prices in domain code creates technical debt and makes the system brittle.

## Decision
Domain code (business logic, routing algorithms) MUST NOT contain hardcoded production model names, capabilities, or prices. All model metadata comes from external sources: configuration files, API endpoints, or databases.

## Rationale

### Maintainability
- Model pricing changes frequently (sometimes weekly)
- New models released regularly
- Deprecations happen without warning
- Hardcoded data becomes stale immediately

### Testability
- Tests use synthetic fixtures, not real model names
- Fixtures can cover edge cases not present in production
- Tests don't break when providers update offerings

### Correctness
- Single source of truth for model metadata
- Version-aware pricing enables audit trail
- Can track when pricing changed for cost variance analysis

## Consequences

### Positive
- Model updates require no code changes
- Pricing updates can be hot-reloaded
- Historical routing decisions preserve pricing at decision time
- Tests are deterministic and don't depend on external state

### Negative
- Need external model catalog service or configuration
- Bootstrap problem: where does initial catalog come from?
- Cache invalidation complexity

### Implementation Requirements

**Model Catalog Interface**:
```typescript
interface ModelCatalog {
  listModels(): Promise<ModelMetadata[]>;
  getModel(model_id: string): Promise<ModelMetadata | null>;
  refreshMetadata(): Promise<void>;
  getMetadataVersion(): string;
}
```

**Metadata Structure**:
```typescript
interface ModelMetadata {
  model_id: string;
  capabilities: string[];
  pricing: PricingInfo;
  metadata_version: string;
  source: string;
  effective_at: Date;
  refreshed_at: Date;
}
```

**Test Fixtures**:
```typescript
// Good
const fixtures = {
  cheapModel: { id: 'test-cheap', cost: 0.001, capabilities: ['text'] },
  expensiveModel: { id: 'test-expensive', cost: 1.0, capabilities: ['text', 'vision'] }
};

// Bad
const fixtures = {
  gpt4: { ... },  // Don't use real model names
  claude: { ... }
};
```

## Alternatives Considered

### Hardcode with Version Constants
Keep model data in code but with explicit versioning. Rejected because:
- Still requires code changes for updates
- Versioning doesn't solve staleness problem
- Deployment required for pricing updates

### Hybrid: Capabilities in Code, Pricing External
Hardcode stable capabilities, externalize volatile pricing. Rejected because:
- Capabilities also change (e.g., context window increases)
- Inconsistent pattern confusing to developers
- Still need external data source anyway

## Reversibility
**Medium**. Can add default embedded catalog for bootstrapping, but should never be used in production routing logic.

## References
- Domain Model: ModelCatalog service
- Security: Pricing metadata versioning for audit
- Testing: Synthetic fixtures requirement
