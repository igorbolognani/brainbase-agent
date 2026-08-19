# Security Architecture

## Threat Model

### Assets
1. **Provider API Credentials**: OAuth tokens, API keys for OpenAI, Anthropic, etc.
2. **Gateway API Keys**: Credentials for external routing services
3. **User Task Data**: Prompts, contexts, execution results
4. **Usage/Billing Data**: Costs, spending patterns
5. **Audit Logs**: Security and compliance trails

### Threats
1. **Credential Exposure**: Leaking provider keys in logs, responses, or model-visible contexts
2. **SSRF Attacks**: User-configured gateway URLs targeting internal services
3. **Tenant Isolation Breach**: Cross-account data access
4. **Budget Bypass**: Executing tasks without proper budget enforcement
5. **Injection Attacks**: SQL injection, command injection in task execution
6. **Replay Attacks**: Re-executing consequential operations without idempotency

## Security Controls

### 1. Credential Protection

#### Never Expose Credentials
**Rule**: Raw provider API keys/tokens MUST NEVER appear in:
- Model-visible MCP arguments
- ChatGPT messages or UI
- Tool transcripts or logs
- MCP responses
- Audit events (structured metadata only)

#### Secure Credential Flow
```
User → ChatGPT → MCP.initiate_connection()
                  ↓
            Returns OAuth URL
                  ↓
        User completes OAuth
                  ↓
    Server receives auth code
                  ↓
  Exchange for access token (server-side)
                  ↓
    Encrypt token with KMS key
                  ↓
  Store in credential vault (access-controlled)
                  ↓
Return opaque connection_id to client
```

#### Credential Storage
- **Encryption at Rest**: AES-256-GCM with KMS-managed keys
- **Access Control**: Service identity required, audit logged
- **Key Rotation**: Periodic rotation with zero-downtime
- **Scope Minimization**: Store only necessary scopes

#### Credential Usage
- **Just-in-Time Decryption**: Decrypt only when making provider API call
- **Memory Protection**: Clear credentials from memory after use
- **Audit Logging**: Log credential access (not values)

### 2. SSRF Protection

User-configured gateway URLs require multiple validation layers:

#### URL Validation
```typescript
function validateGatewayUrl(url: string): ValidationResult {
  // 1. HTTPS only
  if (!url.startsWith('https://')) {
    return { valid: false, reason: 'HTTPS required' };
  }
  
  // 2. Parse and validate hostname
  const parsed = new URL(url);
  
  // 3. DNS resolution
  const ip = await resolveHostname(parsed.hostname);
  
  // 4. IP address blocklist
  if (isBlockedIP(ip)) {
    return { valid: false, reason: 'Blocked IP range' };
  }
  
  // 5. Check redirect policy on first request
  // ... re-validate each redirect hop
  
  return { valid: true };
}

function isBlockedIP(ip: string): boolean {
  return (
    isLoopback(ip) ||        // 127.0.0.0/8, ::1
    isPrivate(ip) ||         // 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
    isLinkLocal(ip) ||       // 169.254.0.0/16, fe80::/10
    isCloudMetadata(ip)      // 169.254.169.254, etc.
  );
}
```

#### Redirect Policy
- Follow HTTPS redirects only
- Re-validate IP address for each hop
- Maximum 3 redirects
- Timeout: 10 seconds total

#### Timeout Enforcement
- Connection timeout: 5 seconds
- Request timeout: 30 seconds
- Abort on timeout, no retry

#### Revalidation
- Periodic DNS revalidation (every 24 hours)
- Invalidate connection on validation failure

### 3. Tenant Isolation

#### Row-Level Security
```sql
-- Enable RLS on all tables
ALTER TABLE connections ENABLE ROW LEVEL SECURITY;

-- Policy: users see only their own data
CREATE POLICY tenant_isolation ON connections
  FOR ALL
  USING (account_id = current_setting('app.current_account_id')::UUID);
```

#### Application-Layer Enforcement
- All queries include `WHERE account_id = $1`
- Service layer validates account_id from auth context
- No cross-account joins permitted

#### Authentication Context
- OAuth/OIDC claims as source of truth
- `issuer` + `subject` → unique account
- Session token includes account_id
- Token validation on every request

### 4. Budget Enforcement

#### Server-Side Validation
```typescript
async function enforceB udget(
  account_id: string,
  estimated_cost: number,
  policy: RoutingPolicy
): Promise<BudgetCheckResult> {
  // 1. Check free_only flag
  if (policy.budget_constraints.free_only && estimated_cost > 0) {
    return { allowed: false, reason: 'free_only policy' };
  }
  
  // 2. Check per-task maximum
  if (estimated_cost > policy.budget_constraints.max_cost_per_task) {
    return { allowed: false, reason: 'exceeds max_cost_per_task' };
  }
  
  // 3. Check daily cap
  const daily_spent = await getDailySpending(account_id);
  if (daily_spent + estimated_cost > policy.budget_constraints.daily_cap) {
    return { allowed: false, reason: 'exceeds daily cap' };
  }
  
  // 4. Check monthly cap
  const monthly_spent = await getMonthlySpending(account_id);
  if (monthly_spent + estimated_cost > policy.budget_constraints.monthly_cap) {
    return { allowed: false, reason: 'exceeds monthly cap' };
  }
  
  return { allowed: true };
}
```

#### Enforcement Point
- BEFORE dispatch to provider
- No client-side bypasses
- Failed checks logged to audit trail

### 5. Idempotency & Replay Protection

#### Idempotency Keys
- Client provides unique key per consequential operation
- Key format: `{client_id}:{uuid}`
- Server deduplicates by (account_id, idempotency_key)

#### Implementation
```typescript
async function executeTask(
  account_id: string,
  task: Task,
  decision: RoutingDecision,
  idempotency_key: string
): Promise<ExecutionAttempt> {
  // 1. Check for existing attempt
  const existing = await getAttemptByKey(account_id, idempotency_key);
  if (existing) {
    return existing; // Return cached result
  }
  
  // 2. Create new attempt
  const attempt = await createAttempt({
    task_id: task.task_id,
    decision_id: decision.decision_id,
    idempotency_key,
    status: 'pending'
  });
  
  // 3. Execute (with retry logic)
  // ...
  
  return attempt;
}
```

#### Key Expiration
- Keys valid for 24 hours
- After expiration, new execution allowed with same key

### 6. Logging & Monitoring

#### Structured Logging
```typescript
interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  account_id?: string;
  event_type: string;
  metadata: Record<string, unknown>; // Only allowlisted fields
}

// Allowlist of loggable fields
const LOGGABLE_FIELDS = [
  'account_id',
  'task_id',
  'route_id',
  'estimated_cost',
  'actual_cost',
  'status',
  // ... NO credential fields
];
```

#### Central Redaction
Defense-in-depth: regex patterns to catch accidental credential leaks

```typescript
const REDACTION_PATTERNS = [
  /sk-[a-zA-Z0-9]{40,}/g,           // OpenAI keys
  /Bearer [a-zA-Z0-9._-]+/g,        // Bearer tokens
  /[a-zA-Z0-9]{32,}/g,              // Generic secrets
];

function redactLog(message: string): string {
  let redacted = message;
  for (const pattern of REDACTION_PATTERNS) {
    redacted = redacted.replace(pattern, '[REDACTED]');
  }
  return redacted;
}
```

**Note**: Do NOT rely solely on regex. Prevention at the source is primary control.

#### Security Monitoring
- Failed authentication attempts
- Budget violations
- SSRF validation failures
- Anomalous spending patterns
- Unusual task execution rates

### 7. Audit Trail

#### Comprehensive Events
- Connection created/revoked
- Route planned (with decision provenance)
- Task executed (with route snapshot)
- Budget enforced/violated
- Policy updated
- Credential accessed (not values)

#### Immutable Log
- Append-only
- Cryptographic integrity (optional: hash chain)
- Retention per compliance requirements
- Export for external SIEM

### 8. Secure Development Practices

#### Input Validation
- Validate all user inputs at API boundary
- Parameterized queries (no string concatenation)
- Strict type checking with TypeScript

#### Dependency Management
- Regular `npm audit`
- Automated security updates
- Pin dependencies, commit lockfile
- SBOM generation for transparency

#### Code Review
- Security-focused reviews for:
  - Credential handling code
  - Budget enforcement logic
  - SSRF protection
  - Tenant isolation queries

#### Testing
- Unit tests for security boundaries
- Integration tests for SSRF protection
- Penetration testing before production

## Incident Response

### Credential Compromise
1. Revoke affected connection
2. Notify account owner
3. Audit access logs
4. Rotate KMS keys if needed

### SSRF Attempt
1. Block offending gateway URL
2. Alert security team
3. Review validation logic
4. Update blocklist if new pattern discovered

### Budget Bypass
1. Halt task execution for affected account
2. Audit decision logs for root cause
3. Refund if appropriate
4. Fix enforcement logic

### Cross-Tenant Access
1. Immediate system-wide audit
2. Notify affected accounts
3. Review RLS policies and application logic
4. External security audit
