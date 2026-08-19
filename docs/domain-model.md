# Domain Model

## Core Concepts

### Account
Represents a user's GPTRouter account with identity and authorization context.

**Properties**:
- `account_id`: Unique identifier
- `issuer`: OAuth/OIDC issuer
- `subject`: OAuth/OIDC subject
- `created_at`: Account creation timestamp

**Security Note**: Account identity derived from OAuth/OIDC authorization context. Do not assume guaranteed ChatGPT user ID/email in every MCP call.

### Connection
Base abstraction for model access routes. Two distinct types: ProviderConnection and GatewayConnection.

#### ProviderConnection
Direct connection to a model provider API.

**Properties**:
- `connection_id`: Unique identifier
- `type`: 'provider' (discriminator)
- `account_id`: Owner account reference
- `provider`: 'openai' | 'anthropic' | 'google' | 'cohere' | 'mistral' | ...
- `status`: 'active' | 'revoked' | 'expired' | 'error'
- `created_at`: Connection establishment timestamp
- `updated_at`: Last status update
- `credential_reference`: Opaque reference to encrypted credentials (NEVER exposed to client)

**Operations**:
- `initiate()`: Start OAuth/OIDC flow
- `complete(auth_code)`: Complete OAuth exchange, store encrypted token
- `revoke()`: Invalidate connection and wipe credentials
- `health_check()`: Verify connection validity

#### GatewayConnection
Connection to an external model gateway/proxy service.

**Properties**:
- `connection_id`: Unique identifier
- `type`: 'gateway' (discriminator)
- `account_id`: Owner account reference
- `gateway_url`: HTTPS endpoint (SSRF-protected, validated)
- `gateway_type`: 'openrouter' | '9router' | 'openai_compatible' | ...
- `status`: 'active' | 'revoked' | 'error'
- `created_at`: Connection establishment timestamp
- `updated_at`: Last status update
- `credential_reference`: Opaque reference to gateway API key

**Validation**:
- HTTPS required
- DNS/IP validation on creation and periodic revalidation
- Blocked: loopback, private ranges, link-local, cloud metadata endpoints
- Redirect policy: follow HTTPS only, validate each hop
- Timeout enforcement

### ModelRoute
A specific route to a model through a connection.

**Properties**:
- `route_id`: Unique identifier
- `route_type`: 'provider' | 'gateway'
- `connection_id`: Reference to connection
- `source_id`: Model identifier (e.g., 'gpt-4o-mini', 'claude-3-5-sonnet')
- `capabilities`: Array of capability strings
- `pricing_metadata_version`: Version of pricing data
- `pricing`: Pricing information
- `availability_status`: 'available' | 'unavailable' | 'degraded'
- `created_at`: Route registration timestamp
- `updated_at`: Last metadata refresh

**Invariants**:
- Same model may have multiple routes (different connections)
- Pricing metadata is version-aware, not canonical truth
- No hardcoded production model names in domain code

### RoutingPolicy
Configuration for route selection behavior.

**Properties**:
- `policy_id`: Unique identifier
- `account_id`: Owner account reference
- `name`: User-friendly name
- `ordering_strategy`: 'cost' | 'quality' | 'latency' | 'custom'
- `admissibility_rules`: Rules for filtering routes
  - `allowed_route_types`: ['provider', 'gateway'] or subset
  - `allowed_providers`: Provider allowlist (empty = all allowed)
  - `blocked_providers`: Provider blocklist
  - `required_capabilities`: Must-have capabilities
  - `excluded_capabilities`: Must-not-have capabilities
- `budget_constraints`: Budget enforcement rules
  - `free_only`: Only use free-tier models
  - `max_cost_per_task`: Maximum spending per task
  - `daily_cap`: Daily spending limit
  - `monthly_cap`: Monthly spending limit
  - `premium_escalation_allowed`: Allow escalation to expensive models
- `manual_override_allowed`: User can override route selection
- `version`: Policy version for provenance

### Task
A unit of work to be executed.

**Properties**:
- `task_id`: Unique identifier
- `account_id`: Owner account reference
- `description`: Task description
- `requirements`: Required capabilities
- `context`: Additional context for execution
- `status`: 'planning' | 'approved' | 'executing' | 'completed' | 'failed' | 'cancelled'
- `created_at`: Task submission timestamp

**Lifecycle**:
1. **Planning**: `route_task()` analyzes requirements, returns decision (NO MONEY SPENT)
2. **Approved**: User confirms execution
3. **Executing**: Task running on selected route
4. **Completed/Failed/Cancelled**: Terminal states

### RoutingDecision
Immutable snapshot of a routing decision with full provenance.

**Properties**:
- `decision_id`: Unique identifier
- `task_id`: Associated task
- `policy_id`: Policy used for decision
- `policy_version`: Version of policy at decision time
- `evaluated_routes`: List of routes considered
- `admissible_routes`: Routes passing admissibility filter
- `selected_route_id`: Chosen route (or null if none admissible)
- `route_snapshot`: Full snapshot of selected route
  - `route_id`
  - `route_type`
  - `connection_id`
  - `source_id`
  - `pricing_metadata_version`
  - `pricing` (snapshot at decision time)
- `rejection_reasons`: Structured reasons for rejected routes
  - `route_id`
  - `reason_code`: 'insufficient_capability' | 'unavailable' | 'policy_violation' | 'budget_exceeded' | ...
  - `details`: Human-readable explanation
- `estimated_cost`: Cost estimate (not canonical)
- `decided_at`: Decision timestamp

**Immutability**: After creation, RoutingDecision is never modified. Provides audit trail.

### ExecutionAttempt
Record of a task execution attempt.

**Properties**:
- `attempt_id`: Unique identifier
- `task_id`: Associated task
- `decision_id`: Routing decision used
- `idempotency_key`: Client-provided key for replay protection
- `status`: 'pending' | 'running' | 'completed' | 'failed' | 'cancel_requested' | 'cancelled'
- `started_at`: Execution start timestamp
- `completed_at`: Execution completion timestamp
- `cancel_requested_at`: Cancellation request timestamp (if applicable)
- `cancelled_at`: Provider-confirmed cancellation timestamp (if applicable)
- `retry_count`: Number of retry attempts
- `retry_policy`: Retry configuration snapshot

**Idempotency**:
- Keyed by (account_id, idempotency_key)
- Duplicate requests return existing result
- Prevents accidental double-execution

**Cancellation Semantics**:
- `cancel_requested_at` set when client requests cancellation
- Best-effort: provider may not support cancellation
- `cancelled_at` only set when provider confirms
- Completion may race with cancellation

### UsageRecord
Reconciled actual usage and cost from provider.

**Properties**:
- `usage_id`: Unique identifier
- `attempt_id`: Associated execution attempt
- `provider_usage_data`: Raw provider usage data (structured)
- `actual_cost`: Reconciled cost in USD
- `cost_breakdown`: Detailed cost components
- `tokens_used`: Token counts (input/output)
- `reconciled_at`: Timestamp of cost reconciliation
- `cost_variance`: Difference from estimated_cost

**Source of Truth**: UsageRecord is the authoritative cost. Estimates are for planning only.

### AuditEvent
Security and compliance audit trail.

**Properties**:
- `event_id`: Unique identifier
- `account_id`: Associated account (if applicable)
- `event_type`: 'connection.created' | 'connection.revoked' | 'route.planned' | 'task.executed' | 'budget.enforced' | 'policy.violated' | ...
- `actor`: Identity of actor (user, system, admin)
- `resource_type`: Type of resource affected
- `resource_id`: Identifier of resource
- `metadata`: Event-specific structured data
- `timestamp`: Event occurrence time

**Append-Only**: AuditEvents are never modified or deleted. Retention policy for compliance.

## Domain Services

### ModelCatalog
Dynamic registry of available models with versioned metadata.

**Interface**:
```typescript
interface ModelCatalog {
  listModels(): Promise<ModelMetadata[]>;
  getModel(model_id: string): Promise<ModelMetadata | null>;
  refreshMetadata(): Promise<void>;
  getMetadataVersion(): string;
}
```

**Characteristics**:
- No hardcoded production models
- External data source (API, DB, config)
- Cached with TTL
- Provenance tracking (source, effective_at, refreshed_at)

### RouteRepository
Storage and retrieval of routes.

**Interface**:
```typescript
interface RouteRepository {
  listRoutes(account_id: string): Promise<ModelRoute[]>;
  getRoute(route_id: string): Promise<ModelRoute | null>;
  getRoutesForConnection(connection_id: string): Promise<ModelRoute[]>;
  updateRouteAvailability(route_id: string, status: AvailabilityStatus): Promise<void>;
}
```

### RoutingEngine
Core routing algorithm implementation.

**Interface**:
```typescript
interface RoutingEngine {
  planRoute(task: Task, policy: RoutingPolicy): Promise<RoutingDecision>;
  validateManualOverride(route_id: string, task: Task, policy: RoutingPolicy): Promise<ValidationResult>;
}
```

**Two-Stage Algorithm**:
1. **Admissibility Filter**: Returns routes satisfying capability, availability, policy, budget, security
2. **Ordering**: Sorts admissible routes by policy (cost, quality, latency, custom)

### BudgetEnforcer
Server-side budget constraint validation.

**Interface**:
```typescript
interface BudgetEnforcer {
  checkBudget(account_id: string, estimated_cost: number, policy: RoutingPolicy): Promise<BudgetCheckResult>;
  recordSpending(account_id: string, usage: UsageRecord): Promise<void>;
  getSpendingSummary(account_id: string, period: 'daily' | 'monthly'): Promise<SpendingSummary>;
}
```

**Enforcement Points**:
- Pre-execution validation (before consequential action)
- Real-time quota checks
- Spending caps (daily, monthly, per-task)

### ExecutionCoordinator
Manages task execution lifecycle.

**Interface**:
```typescript
interface ExecutionCoordinator {
  executeTask(
    task: Task,
    decision: RoutingDecision,
    idempotency_key: string
  ): Promise<ExecutionAttempt>;
  cancelExecution(attempt_id: string): Promise<CancellationResult>;
  getExecutionStatus(attempt_id: string): Promise<ExecutionAttempt>;
}
```

**Responsibilities**:
- Idempotency enforcement
- Retry logic with provenance
- Cancellation coordination (best-effort)
- Usage record creation

## Domain Invariants

### Security
1. Raw credentials NEVER appear in domain objects exposed to client
2. Connection objects return opaque references only
3. All gateway URLs validated against SSRF attack vectors

### Cost Tracking
1. `estimated_cost` is advisory, not authoritative
2. `actual_cost` from UsageRecord is source of truth
3. All costs tagged with pricing_metadata_version

### Provenance
1. RoutingDecision is immutable after creation
2. Route snapshot captures pricing metadata version
3. Policy version captured in decision
4. Full audit trail for all consequential actions

### Idempotency
1. ExecutionAttempt keyed by (account_id, idempotency_key)
2. Duplicate requests return existing result
3. No silent failures or lost actions

### Tenant Isolation
1. All domain operations scoped to account_id
2. Cross-account access forbidden
3. Connections owned by single account
4. Routes accessible only via owned connections
