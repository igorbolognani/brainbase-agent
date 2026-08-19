# Architecture

## System Overview

GPTRouter is built as a unified application using OpenAI Apps SDK with MCP (Model Context Protocol) for server-side logic. The architecture prioritizes security, cost optimization, and routing correctness.

```
┌─────────────────────────────────────────────────────────────┐
│                    ChatGPT Interface                        │
│              (OpenAI Apps SDK Integration)                  │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           │ MCP Protocol
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                    GPTRouter MCP Server                     │
│  ┌────────────────────────────────────────────────────┐    │
│  │            Connection Management                    │    │
│  │  (OAuth/OIDC, Status, No Credential Exposure)     │    │
│  └────────────────────────────────────────────────────┘    │
│  ┌────────────────────────────────────────────────────┐    │
│  │              Routing Engine                         │    │
│  │  • Admissibility Filter                            │    │
│  │  • Ordering by Policy                              │    │
│  │  • Route Validation                                │    │
│  └────────────────────────────────────────────────────┘    │
│  ┌────────────────────────────────────────────────────┐    │
│  │           Budget Enforcement                        │    │
│  │  • Server-side quotas                              │    │
│  │  • Pre-execution validation                        │    │
│  └────────────────────────────────────────────────────┘    │
│  ┌────────────────────────────────────────────────────┐    │
│  │            Execution Coordinator                    │    │
│  │  • Idempotency                                     │    │
│  │  • Cancellation (best-effort)                      │    │
│  │  • Provenance tracking                             │    │
│  └────────────────────────────────────────────────────┘    │
└──────────────────────────┬──────────────────────────────────┘
                           │
          ┌────────────────┼────────────────┐
          │                │                │
          ▼                ▼                ▼
┌─────────────────┐ ┌──────────────┐ ┌─────────────────┐
│ Provider APIs   │ │   Gateway    │ │   Credential    │
│ (OpenAI, etc.)  │ │  Services    │ │     Vault       │
│                 │ │ (Optional)   │ │  (Encrypted)    │
└─────────────────┘ └──────────────┘ └─────────────────┘
```

## Architectural Layers

### Presentation Layer

- **OpenAI Apps SDK UI**: Responsive, mobile-friendly React components
- **MCP Protocol Interface**: Structured request/response handling
- **No Credential Exposure**: Only connection IDs and status visible to client

### Application Layer

- **Connection Management**: OAuth/OIDC flows, connection lifecycle
- **Routing Engine**: Two-stage routing algorithm (admissibility + ordering)
- **Budget Enforcement**: Pre-execution validation, quota management
- **Task Orchestration**: Planning vs. execution separation
- **Audit Logging**: Structured logs with allowlist + central redaction

### Domain Layer

- **Route Planning**: Capability matching, policy evaluation
- **Cost Estimation**: Version-aware pricing metadata
- **Execution Provenance**: Immutable snapshots of routing decisions
- **Idempotency**: Replay protection for consequential operations

### Infrastructure Layer

- **Credential Storage**: Encrypted at rest, access-controlled
- **Model Catalog**: Dynamic metadata with provenance and versioning
- **Audit Store**: Append-only event log
- **Provider Adapters**: Abstracted provider-specific implementations

## Key Architectural Patterns

### Separation of Planning and Execution

**Planning Phase** (`route_task`):

- MUST NOT spend money
- Returns routing decision with estimated cost
- Evaluates admissibility and ordering
- Fast, safe, repeatable

**Execution Phase** (`run_task`):

- Consequential action
- Server-side budget enforcement
- Idempotency key required
- Records actual cost from provider

### Two-Stage Routing

**Stage 1: Admissibility Filter**

```
Input: Task requirements
Output: Set of admissible routes

For each potential route:
  ✓ Does the model have required capabilities?
  ✓ Is the connection available/healthy?
  ✓ Does the route satisfy policy constraints?
  ✓ Is there sufficient budget remaining?
  ✓ Do security policies permit this route?
```

**Stage 2: Ordering**

```
Input: Admissible routes
Output: Ordered list

Sort by configured policy:
  • Cost (lowest first) - DEFAULT
  • Quality (highest capability first)
  • Latency (fastest expected response)
  • Custom user preferences
```

### Connection Abstraction

```typescript
// Two distinct connection types
interface ProviderConnection {
  type: 'provider';
  provider: 'openai' | 'anthropic' | 'google' | ...;
  // ... no raw credentials
}

interface GatewayConnection {
  type: 'gateway';
  gatewayUrl: string; // HTTPS, validated, SSRF-protected
  // ... no raw credentials
}

type Connection = ProviderConnection | GatewayConnection;
```

### Route Identity and Provenance

Every route maintains full identity:

- `route_id`: Stable identifier
- `route_type`: 'provider' | 'gateway'
- `connection_id`: Reference to connection
- `source_id`: Model/capability identifier
- `pricing_metadata_version`: Version of pricing data used

### Idempotency and Cancellation

**Idempotency**:

- Client provides idempotency key for all consequential operations
- Server deduplicates based on key + account
- Returns existing result if key already processed

**Cancellation**:

- Best-effort only
- `cancel_requested` timestamp != `cancelled_by_provider`
- Completion may race with cancellation
- Clear semantics in contracts

### Credential Security

**Principles**:

1. NEVER expose raw credentials in model-visible contexts
2. Capture via OAuth/OIDC or encrypted server-side UI
3. Store encrypted at rest with access controls
4. MCP returns opaque connection IDs only
5. Provider adapters decrypt just-in-time for API calls

**Flow**:

```
User → ChatGPT → MCP initiate_connection()
                  ↓
            OAuth/OIDC flow
                  ↓
         Server captures token
                  ↓
        Encrypt & store in vault
                  ↓
    Return connection_id to client
```

### SSRF Protection

User-configured gateway URLs require:

- HTTPS only (no HTTP, no other schemes)
- DNS resolution validation
- IP address validation against blocklist:
  - Loopback (127.0.0.0/8, ::1)
  - Private (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)
  - Link-local (169.254.0.0/16, fe80::/10)
  - Cloud metadata endpoints (169.254.169.254, etc.)
- Redirect policy: follow HTTPS only, re-validate each hop
- Timeout enforcement
- Future: optional local bridge with separate security design

### Budget Enforcement

**Server-Side Validation** (before execution):

```
Check budget constraints:
  ✓ free_only flag (no paid routes)
  ✓ max_cost_per_task
  ✓ daily spending cap
  ✓ monthly spending cap
  ✓ allowed route classes
  ✓ premium escalation policy
```

**Cost Tracking**:

- `estimated_cost`: From route metadata (version-aware)
- `actual_cost`: From provider usage records (reconciled)
- `cost_variance`: Track estimate accuracy
- Estimates are NOT canonical truth

### Model Catalog Design

**Dynamic Metadata**:

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

**No Hardcoded Production Data**:

- Domain code contains no hardcoded model names or prices
- Catalog loaded from external source (API, DB, config)
- Tests use synthetic fixtures
- Pricing versioned for audit trail

### Audit and Observability

**Structured Logging**:

- Allowlist of loggable fields
- Central redaction as defense-in-depth
- Never rely solely on regex for secret safety

**Audit Events**:

- Connection created/revoked
- Route planning performed
- Task executed
- Budget enforced
- Policy violated
- Cancellation requested/completed

**Provenance Snapshots**:

- Full route snapshot in RoutingDecision
- Immutable after creation
- Includes pricing metadata version, policy version
- Enables reproducible analysis

## Non-Functional Characteristics

### Scalability

- Stateless routing engine (horizontally scalable)
- Catalog cache with TTL
- Async execution tracking
- Connection pool management

### Reliability

- Provider health monitoring
- Automatic failover to alternative routes
- Retry policies with exponential backoff
- Circuit breakers for unhealthy providers

### Security

- Defense in depth for credential protection
- Tenant isolation at data layer
- SSRF protection with allowlist + validation
- Audit trail for compliance

### Performance

- Route planning: O(n) where n = available routes
- Catalog lookup: O(1) with caching
- Budget check: O(1) with cached quotas
- Execution dispatch: async, non-blocking

## Technology Choices

### TypeScript + ESM

- Modern module system
- Type safety throughout
- Tree-shaking for smaller bundles

### OpenAI Apps SDK

- Native ChatGPT integration
- Consistent UI patterns
- OAuth flow support

### MCP (Model Context Protocol)

- Server-side business logic
- Secure credential handling
- Structured tool contracts

### Monorepo Structure

- Clear package boundaries
- Shared contracts package
- Independent versioning where needed

## Deployment Architecture

### MCP Server

- Node.js runtime
- Deployed as isolated service
- Environment-based configuration
- Secrets via environment variables or secret manager

### Credential Vault

- Encrypted at rest
- Access-controlled by service identity
- Audit log for all access
- Key rotation support

### Model Catalog

- External data source
- Cached with TTL
- Version-controlled updates
- Rollback capability

### Audit Store

- Append-only log
- Indexed for queries
- Retention policy enforcement
- Export for compliance
