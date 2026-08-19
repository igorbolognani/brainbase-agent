# ADR 003: Provider and Gateway as Distinct Connection Types

## Status

Accepted

## Context

GPTRouter needs to support two routing paths:

1. Direct connections to model providers (OpenAI, Anthropic, etc.)
2. Optional connections to external model gateways/proxies (OpenRouter, 9 Router, etc.)

These have different security models, configuration requirements, and runtime behavior.

## Decision

`ProviderConnection` and `GatewayConnection` are separate first-class types with different validation, security requirements, and capabilities. They share a common `Connection` abstraction but are not interchangeable.

## Rationale

### Security

- Provider connections use OAuth/OIDC flows (standardized, well-audited)
- Gateway connections use user-configured URLs (SSRF risk, require validation)
- Different credential storage and access patterns
- Different trust boundaries

### Configuration

- Providers: predefined set, server-controlled endpoints
- Gateways: user-provided URLs, arbitrary external services
- Different validation requirements (allowlist vs. blocklist)

### Runtime Behavior

- Providers: Direct API calls, standard SDKs
- Gateways: HTTP proxies, varying compatibility levels
- Different retry/fallback logic
- Different health check mechanisms

## Consequences

### Positive

- Clear security boundaries
- Type system enforces correct handling
- Can apply different validation rules
- Audit trails distinguish connection types

### Negative

- More types to maintain
- Some code duplication for common connection logic
- Need discriminated unions in TypeScript

### Implementation

```typescript
interface ProviderConnection {
  type: 'provider';
  connection_id: string;
  account_id: string;
  provider: 'openai' | 'anthropic' | 'google' | ...;
  status: ConnectionStatus;
  credential_reference: string;  // OAuth token
}

interface GatewayConnection {
  type: 'gateway';
  connection_id: string;
  account_id: string;
  gateway_url: string;  // HTTPS, validated
  gateway_type: 'openrouter' | '9router' | 'openai_compatible';
  status: ConnectionStatus;
  credential_reference: string;  // API key
}

type Connection = ProviderConnection | GatewayConnection;
```

**Validation**:

```typescript
function validateConnection(conn: Connection): ValidationResult {
  switch (conn.type) {
    case 'provider':
      return validateProviderConnection(conn);
    case 'gateway':
      return validateGatewayConnection(conn); // SSRF checks
  }
}
```

## Alternatives Considered

### Single Connection Type with Flags

Use one `Connection` type with `is_gateway` flag. Rejected because:

- Weak type safety (can't enforce validation at compile time)
- Easy to forget gateway-specific security checks
- Unclear which fields apply to which connection mode

### Subclassing

Use OOP inheritance hierarchy. Rejected because:

- TypeScript discriminated unions are more idiomatic
- Harder to serialize/deserialize
- Runtime type checking is less ergonomic

### Separate Domains

Treat provider and gateway routing as entirely separate features. Rejected because:

- Both produce ModelRoutes (same routing algorithm)
- UX should present unified view
- Over-isolation for shared functionality

## Reversibility

**Low**. This is a foundational type decision. Changing later would require database migration and significant refactoring. However, we can add new connection types (e.g., `LocalConnection` for future local bridge) without breaking existing types.

## References

- Security: SSRF protection for gateway URLs
- Domain Model: Connection abstractions
- Data Model: `connections` table with type discriminator
