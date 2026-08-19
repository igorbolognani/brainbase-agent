# Data Model

## Entity Relationships

```
Account 1---* Connection
Connection 1---* ModelRoute
Account 1---* RoutingPolicy
Account 1---* Task
Task 1---* RoutingDecision
RoutingDecision 1---* ExecutionAttempt
ExecutionAttempt 1---1 UsageRecord
Account 1---* AuditEvent
```

## Schema Definitions

### accounts

```sql
CREATE TABLE accounts (
  account_id UUID PRIMARY KEY,
  issuer VARCHAR(255) NOT NULL,
  subject VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(issuer, subject)
);
```

### connections

```sql
CREATE TABLE connections (
  connection_id UUID PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES accounts(account_id),
  connection_type VARCHAR(20) NOT NULL CHECK (connection_type IN ('provider', 'gateway')),
  provider VARCHAR(50), -- for provider connections
  gateway_url TEXT, -- for gateway connections, HTTPS validated
  gateway_type VARCHAR(50), -- for gateway connections
  status VARCHAR(20) NOT NULL CHECK (status IN ('active', 'revoked', 'expired', 'error')),
  credential_reference VARCHAR(255) NOT NULL, -- opaque reference to encrypted credentials
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CHECK (
    (connection_type = 'provider' AND provider IS NOT NULL AND gateway_url IS NULL) OR
    (connection_type = 'gateway' AND gateway_url IS NOT NULL AND provider IS NULL)
  )
);
CREATE INDEX idx_connections_account ON connections(account_id);
```

### model_routes

```sql
CREATE TABLE model_routes (
  route_id UUID PRIMARY KEY,
  connection_id UUID NOT NULL REFERENCES connections(connection_id),
  route_type VARCHAR(20) NOT NULL CHECK (route_type IN ('provider', 'gateway')),
  source_id VARCHAR(255) NOT NULL, -- model identifier
  capabilities TEXT[] NOT NULL,
  pricing_metadata_version VARCHAR(50) NOT NULL,
  pricing JSONB NOT NULL, -- structured pricing info
  availability_status VARCHAR(20) NOT NULL CHECK (availability_status IN ('available', 'unavailable', 'degraded')),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_routes_connection ON model_routes(connection_id);
CREATE INDEX idx_routes_source ON model_routes(source_id);
```

### routing_policies

```sql
CREATE TABLE routing_policies (
  policy_id UUID PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES accounts(account_id),
  name VARCHAR(255) NOT NULL,
  ordering_strategy VARCHAR(20) NOT NULL CHECK (ordering_strategy IN ('cost', 'quality', 'latency', 'custom')),
  admissibility_rules JSONB NOT NULL,
  budget_constraints JSONB NOT NULL,
  manual_override_allowed BOOLEAN NOT NULL DEFAULT TRUE,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_policies_account ON routing_policies(account_id);
```

### tasks

```sql
CREATE TABLE tasks (
  task_id UUID PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES accounts(account_id),
  description TEXT NOT NULL,
  requirements JSONB NOT NULL,
  context JSONB,
  status VARCHAR(20) NOT NULL CHECK (status IN ('planning', 'approved', 'executing', 'completed', 'failed', 'cancelled')),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_tasks_account ON tasks(account_id);
CREATE INDEX idx_tasks_status ON tasks(status);
```

### routing_decisions

```sql
CREATE TABLE routing_decisions (
  decision_id UUID PRIMARY KEY,
  task_id UUID NOT NULL REFERENCES tasks(task_id),
  policy_id UUID NOT NULL REFERENCES routing_policies(policy_id),
  policy_version INTEGER NOT NULL,
  evaluated_routes JSONB NOT NULL, -- array of route IDs
  admissible_routes JSONB NOT NULL, -- array of route IDs
  selected_route_id UUID REFERENCES model_routes(route_id),
  route_snapshot JSONB NOT NULL, -- immutable snapshot
  rejection_reasons JSONB NOT NULL, -- array of {route_id, reason_code, details}
  estimated_cost DECIMAL(10,4),
  decided_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_decisions_task ON routing_decisions(task_id);
```

### execution_attempts

```sql
CREATE TABLE execution_attempts (
  attempt_id UUID PRIMARY KEY,
  task_id UUID NOT NULL REFERENCES tasks(task_id),
  decision_id UUID NOT NULL REFERENCES routing_decisions(decision_id),
  idempotency_key VARCHAR(255) NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancel_requested', 'cancelled')),
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  cancel_requested_at TIMESTAMP,
  cancelled_at TIMESTAMP,
  retry_count INTEGER NOT NULL DEFAULT 0,
  retry_policy JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(account_id, idempotency_key) -- via tasks join
);
CREATE INDEX idx_attempts_task ON execution_attempts(task_id);
CREATE INDEX idx_attempts_idempotency ON execution_attempts(idempotency_key);
```

### usage_records

```sql
CREATE TABLE usage_records (
  usage_id UUID PRIMARY KEY,
  attempt_id UUID NOT NULL REFERENCES execution_attempts(attempt_id),
  provider_usage_data JSONB NOT NULL,
  actual_cost DECIMAL(10,4) NOT NULL,
  cost_breakdown JSONB NOT NULL,
  tokens_used JSONB, -- {input: N, output: M}
  reconciled_at TIMESTAMP NOT NULL DEFAULT NOW(),
  cost_variance DECIMAL(10,4) -- actual - estimated
);
CREATE INDEX idx_usage_attempt ON usage_records(attempt_id);
```

### audit_events

```sql
CREATE TABLE audit_events (
  event_id UUID PRIMARY KEY,
  account_id UUID REFERENCES accounts(account_id),
  event_type VARCHAR(100) NOT NULL,
  actor VARCHAR(255) NOT NULL,
  resource_type VARCHAR(50),
  resource_id UUID,
  metadata JSONB NOT NULL,
  timestamp TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_audit_account ON audit_events(account_id);
CREATE INDEX idx_audit_type ON audit_events(event_type);
CREATE INDEX idx_audit_timestamp ON audit_events(timestamp);
```

## Data Integrity Constraints

### Referential Integrity

- All foreign keys enforced with CASCADE or RESTRICT as appropriate
- Deleting an account cascades to connections, policies, tasks, audit events
- Deleting a connection cascades to routes
- Deleting a task cascades to decisions and attempts

### Immutability

- `routing_decisions`: Never UPDATE, only INSERT
- `audit_events`: Append-only, never UPDATE or DELETE (retention policy only)
- `usage_records`: Never UPDATE after initial INSERT

### Validation

- `connections.gateway_url`: HTTPS validated at application layer before INSERT/UPDATE
- `connections.credential_reference`: Never directly queried by client
- All ENUM-like fields enforced with CHECK constraints

### Tenant Isolation

- Row-level security policies ensure account_id filtering
- All queries scoped to authenticated account
- Cross-account joins forbidden

## Indexing Strategy

### High-Volume Query Patterns

1. List routes for account (via connections)
2. Get task history for account
3. Audit log queries (by account, type, time range)
4. Idempotency lookups (by key)
5. Budget calculations (sum usage by account + time window)

### Composite Indexes (if needed based on query analysis)

```sql
CREATE INDEX idx_tasks_account_status ON tasks(account_id, status);
CREATE INDEX idx_audit_account_timestamp ON audit_events(account_id, timestamp DESC);
```

## Retention and Archival

### Audit Events

- Retain 90 days online
- Archive to cold storage after 90 days
- Legal hold capability for compliance

### Usage Records

- Retain indefinitely for billing reconciliation
- Summarize to daily aggregates after 12 months

### Execution Attempts

- Retain completed attempts 30 days
- Archive to cold storage after 30 days
- Keep metadata, archive detailed logs separately
