# API Contracts

## MCP Tool Definitions

### Connection Management

#### initiate_provider_connection

Initiates OAuth/OIDC flow for a provider connection.

**Input**:

```typescript
{
  provider: 'openai' | 'anthropic' | 'google' | 'cohere' | 'mistral';
}
```

**Output**:

```typescript
{
  oauth_url: string; // URL for user to complete OAuth
  state: string; // CSRF protection state parameter
}
```

**Security**: No credentials in request or response. OAuth URL includes state parameter for CSRF protection.

#### initiate_gateway_connection

Initiates connection to an external gateway.

**Input**:

```typescript
{
  gateway_url: string; // HTTPS only, will be validated
  gateway_type: 'openrouter' | '9router' | 'openai_compatible';
}
```

**Output**:

```typescript
{
  validation_result: {
    valid: boolean;
    reason?: string;
  };
  setup_instructions: string;  // How to provide API key securely
}
```

**Security**: URL validated for SSRF before returning. Actual API key captured through separate secure flow.

#### list_connections

Lists all active connections for the authenticated account.

**Input**: (none)

**Output**:

```typescript
{
  connections: Array<{
    connection_id: string;
    type: 'provider' | 'gateway';
    provider?: string; // for provider connections
    gateway_url?: string; // for gateway connections
    gateway_type?: string; // for gateway connections
    status: 'active' | 'error';
    created_at: string;
  }>;
}
```

**Security**: Only returns opaque connection IDs and status. No credentials.

#### revoke_connection

Revokes a connection and wipes credentials.

**Input**:

```typescript
{
  connection_id: string;
}
```

**Output**:

```typescript
{
  success: boolean;
  connection_id: string;
  status: 'revoked';
}
```

### Routing

#### route_task

Plans a route for a task WITHOUT executing it (no money spent).

**Input**:

```typescript
{
  description: string;
  requirements: {
    capabilities: string[];
    context?: Record<string, unknown>;
  };
  policy_id?: string;  // Use specific policy, or default
}
```

**Output**:

```typescript
{
  decision_id: string;
  selected_route: {
    route_id: string;
    source_id: string;  // Model name
    route_type: 'provider' | 'gateway';
    estimated_cost: number;
    confidence: 'high' | 'medium' | 'low';
  } | null;
  rejection_reasons: Array<{
    route_id: string;
    reason_code: string;
    details: string;
  }>;
  admissible_count: number;
  total_evaluated: number;
}
```

**Guarantees**: No execution, no cost. Safe to call repeatedly.

#### run_task

Executes a task with the selected route (consequential, spends money).

**Input**:

```typescript
{
  task_id: string;
  decision_id: string;
  idempotency_key: string;  // Required for replay protection
  manual_override_route_id?: string;  // Override route selection
}
```

**Output**:

```typescript
{
  attempt_id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  estimated_cost: number;
  budget_check: {
    allowed: boolean;
    reason?: string;
  };
}
```

**Idempotency**: Same idempotency_key returns existing attempt. No double-execution.

#### get_execution_status

Retrieves current status of a task execution.

**Input**:

```typescript
{
  attempt_id: string;
}
```

**Output**:

```typescript
{
  attempt_id: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancel_requested' | 'cancelled';
  started_at?: string;
  completed_at?: string;
  actual_cost?: number;  // Only when completed
  result?: unknown;      // Execution result if completed
}
```

#### cancel_execution

Requests cancellation of a running task (best-effort).

**Input**:

```typescript
{
  attempt_id: string;
}
```

**Output**:

```typescript
{
  attempt_id: string;
  cancel_requested_at: string;
  status: 'cancel_requested' | 'cancelled' | 'completed';
  note: string; // Explains cancellation semantics
}
```

**Semantics**: Best-effort only. Provider may not support cancellation. Completion may race.

### Model Catalog

#### list_models

Lists available models with capabilities and pricing.

**Input**:

```typescript
{
  filter?: {
    capabilities?: string[];
    max_cost?: number;
  };
}
```

**Output**:

```typescript
{
  models: Array<{
    model_id: string;
    capabilities: string[];
    pricing: {
      input_cost_per_1k: number;
      output_cost_per_1k: number;
      metadata_version: string;
    };
    availability: 'available' | 'unavailable' | 'degraded';
    routes_available: number; // How many routes to this model
  }>;
  metadata_version: string;
  refreshed_at: string;
}
```

**Note**: Pricing is version-aware and NOT canonical truth. Actual cost from usage records.

### Budget & Usage

#### get_budget_status

Retrieves current budget status and spending.

**Input**:

```typescript
{
  period?: 'daily' | 'monthly';
}
```

**Output**:

```typescript
{
  period: 'daily' | 'monthly';
  spent: number;
  limit: number;
  remaining: number;
  tasks_executed: number;
  average_cost_per_task: number;
}
```

#### update_budget_policy

Updates budget constraints for the account.

**Input**:

```typescript
{
  policy_id: string;
  budget_constraints: {
    free_only?: boolean;
    max_cost_per_task?: number;
    daily_cap?: number;
    monthly_cap?: number;
    premium_escalation_allowed?: boolean;
  };
}
```

**Output**:

```typescript
{
  policy_id: string;
  version: number; // Incremented
  updated_at: string;
}
```

### Audit

#### get_audit_log

Retrieves audit events for the account.

**Input**:

```typescript
{
  event_type?: string;
  start_time?: string;
  end_time?: string;
  limit?: number;
  offset?: number;
}
```

**Output**:

```typescript
{
  events: Array<{
    event_id: string;
    event_type: string;
    timestamp: string;
    resource_type?: string;
    resource_id?: string;
    metadata: Record<string, unknown>; // No credentials
  }>;
  total_count: number;
  has_more: boolean;
}
```

**Security**: Metadata never includes credentials, only allowlisted fields.

## Error Responses

All tools return errors in consistent format:

```typescript
{
  error: {
    code: string;  // Machine-readable error code
    message: string;  // Human-readable message
    details?: Record<string, unknown>;  // Additional context
  };
}
```

### Error Codes

- `invalid_input`: Malformed request
- `authentication_failed`: Invalid or expired auth
- `authorization_failed`: Insufficient permissions
- `connection_error`: Provider/gateway unreachable
- `budget_exceeded`: Operation would exceed budget limits
- `route_unavailable`: No admissible routes found
- `idempotency_conflict`: Idempotency key mismatch
- `validation_failed`: SSRF or other validation failure
- `rate_limited`: Too many requests

## Type Definitions

### Common Types

```typescript
type ConnectionType = 'provider' | 'gateway';
type RouteType = 'provider' | 'gateway';
type ConnectionStatus = 'active' | 'revoked' | 'expired' | 'error';
type AvailabilityStatus = 'available' | 'unavailable' | 'degraded';
type TaskStatus = 'planning' | 'approved' | 'executing' | 'completed' | 'failed' | 'cancelled';
type ExecutionStatus =
  'pending' | 'running' | 'completed' | 'failed' | 'cancel_requested' | 'cancelled';
type OrderingStrategy = 'cost' | 'quality' | 'latency' | 'custom';

type RejectionReasonCode =
  | 'insufficient_capability'
  | 'unavailable'
  | 'policy_violation'
  | 'budget_exceeded'
  | 'security_policy'
  | 'manual_override_invalid';
```

## Versioning

- API version included in MCP server metadata
- Breaking changes require major version bump
- Backward-compatible additions allowed in minor versions
- Clients should handle unknown fields gracefully
