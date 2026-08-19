# Technical Design

## Implementation Patterns

### Two-Stage Routing Algorithm

```typescript
class RoutingEngine {
  async planRoute(
    task: Task,
    policy: RoutingPolicy,
    availableRoutes: ModelRoute[]
  ): Promise<RoutingDecision> {
    // Stage 1: Admissibility Filter
    const admissibleRoutes = await this.filterAdmissible(
      availableRoutes,
      task,
      policy
    );
    
    // Stage 2: Ordering
    const orderedRoutes = this.orderRoutes(admissibleRoutes, policy);
    
    // Select top route (or null if none admissible)
    const selectedRoute = orderedRoutes[0] || null;
    
    // Build decision with full provenance
    return {
      decision_id: generateId(),
      task_id: task.task_id,
      policy_id: policy.policy_id,
      policy_version: policy.version,
      evaluated_routes: availableRoutes.map(r => r.route_id),
      admissible_routes: admissibleRoutes.map(r => r.route_id),
      selected_route_id: selectedRoute?.route_id || null,
      route_snapshot: selectedRoute ? this.snapshotRoute(selectedRoute) : null,
      rejection_reasons: this.buildRejectionReasons(availableRoutes, admissibleRoutes),
      estimated_cost: selectedRoute ? this.estimateCost(selectedRoute, task) : null,
      decided_at: new Date()
    };
  }
  
  private async filterAdmissible(
    routes: ModelRoute[],
    task: Task,
    policy: RoutingPolicy
  ): Promise<ModelRoute[]> {
    const admissible: ModelRoute[] = [];
    
    for (const route of routes) {
      // Check capability match
      if (!this.hasRequiredCapabilities(route, task.requirements)) {
        continue;
      }
      
      // Check availability
      if (route.availability_status !== 'available') {
        continue;
      }
      
      // Check policy constraints
      if (!this.satisfiesPolicy(route, policy)) {
        continue;
      }
      
      // Check budget (estimated cost)
      const estimatedCost = this.estimateCost(route, task);
      if (!await this.checkBudget(task.account_id, estimatedCost, policy)) {
        continue;
      }
      
      admissible.push(route);
    }
    
    return admissible;
  }
  
  private orderRoutes(
    routes: ModelRoute[],
    policy: RoutingPolicy
  ): ModelRoute[] {
    switch (policy.ordering_strategy) {
      case 'cost':
        return routes.sort((a, b) => 
          this.estimateCost(a) - this.estimateCost(b)
        );
      case 'quality':
        return routes.sort((a, b) => 
          this.qualityScore(b) - this.qualityScore(a)
        );
      case 'latency':
        return routes.sort((a, b) => 
          this.latencyEstimate(a) - this.latencyEstimate(b)
        );
      case 'custom':
        return this.applyCustomOrdering(routes, policy);
      default:
        return routes;
    }
  }
}
```

### Idempotency Implementation

```typescript
class ExecutionCoordinator {
  async executeTask(
    account_id: string,
    task: Task,
    decision: RoutingDecision,
    idempotency_key: string
  ): Promise<ExecutionAttempt> {
    // Check for existing attempt
    const existing = await this.repository.getAttemptByIdempotencyKey(
      account_id,
      idempotency_key
    );
    
    if (existing) {
      // Return cached result
      return existing;
    }
    
    // Enforce budget before execution
    const budgetCheck = await this.budgetEnforcer.checkBudget(
      account_id,
      decision.estimated_cost,
      await this.getPolicyForDecision(decision)
    );
    
    if (!budgetCheck.allowed) {
      throw new BudgetExceededError(budgetCheck.reason);
    }
    
    // Create new attempt
    const attempt = await this.repository.createAttempt({
      task_id: task.task_id,
      decision_id: decision.decision_id,
      idempotency_key,
      status: 'pending',
      retry_count: 0
    });
    
    // Dispatch execution (async)
    this.dispatchExecution(attempt);
    
    return attempt;
  }
  
  private async dispatchExecution(attempt: ExecutionAttempt): Promise<void> {
    try {
      await this.repository.updateAttemptStatus(attempt.attempt_id, 'running', {
        started_at: new Date()
      });
      
      // Get route and connection details
      const decision = await this.repository.getDecision(attempt.decision_id);
      const route = decision.route_snapshot;
      const connection = await this.repository.getConnection(route.connection_id);
      
      // Get provider adapter
      const adapter = this.getProviderAdapter(connection);
      
      // Execute task through adapter
      const result = await adapter.executeTask(attempt.task_id, route);
      
      // Record usage
      await this.recordUsage(attempt, result);
      
      // Update status
      await this.repository.updateAttemptStatus(attempt.attempt_id, 'completed', {
        completed_at: new Date(),
        result
      });
    } catch (error) {
      // Handle failure with retry logic
      await this.handleExecutionFailure(attempt, error);
    }
  }
}
```

### Credential Management

```typescript
class CredentialVault {
  private kms: KMSClient;
  private storage: SecureStorage;
  
  async storeCredential(
    connection_id: string,
    credential: ProviderCredential
  ): Promise<string> {
    // Generate data key from KMS
    const dataKey = await this.kms.generateDataKey();
    
    // Encrypt credential with data key
    const encrypted = this.encrypt(credential, dataKey);
    
    // Store encrypted credential
    const reference = await this.storage.store(connection_id, {
      encrypted_data: encrypted,
      encrypted_key: dataKey.encrypted,
      algorithm: 'AES-256-GCM',
      created_at: new Date()
    });
    
    // Audit log (no credential values)
    await this.auditLog.record({
      event_type: 'credential.stored',
      connection_id,
      timestamp: new Date()
    });
    
    // Return opaque reference
    return reference;
  }
  
  async retrieveCredential(
    credential_reference: string
  ): Promise<ProviderCredential> {
    // Audit log access
    await this.auditLog.record({
      event_type: 'credential.accessed',
      credential_reference,
      timestamp: new Date()
    });
    
    // Retrieve encrypted credential
    const stored = await this.storage.retrieve(credential_reference);
    
    // Decrypt data key with KMS
    const dataKey = await this.kms.decrypt(stored.encrypted_key);
    
    // Decrypt credential with data key
    const credential = this.decrypt(stored.encrypted_data, dataKey);
    
    // Clear sensitive data from memory after use
    dataKey.plaintext.fill(0);
    
    return credential;
  }
  
  async revokeCredential(credential_reference: string): Promise<void> {
    // Wipe credential data
    await this.storage.delete(credential_reference);
    
    // Audit log
    await this.auditLog.record({
      event_type: 'credential.revoked',
      credential_reference,
      timestamp: new Date()
    });
  }
}
```

### SSRF Protection

```typescript
class GatewayURLValidator {
  private blockedRanges: IPRange[];
  
  async validate(url: string): Promise<ValidationResult> {
    // 1. HTTPS only
    if (!url.startsWith('https://')) {
      return { valid: false, reason: 'HTTPS required' };
    }
    
    try {
      // 2. Parse URL
      const parsed = new URL(url);
      
      // 3. Resolve hostname to IP
      const addresses = await dns.resolve(parsed.hostname);
      
      // 4. Check each IP against blocklist
      for (const ip of addresses) {
        if (this.isBlockedIP(ip)) {
          return {
            valid: false,
            reason: `Blocked IP range: ${ip}`,
            ip
          };
        }
      }
      
      // 5. Test connection with redirect validation
      await this.testConnection(url);
      
      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        reason: error.message
      };
    }
  }
  
  private isBlockedIP(ip: string): boolean {
    const addr = ipaddr.parse(ip);
    
    // Check loopback
    if (addr.range() === 'loopback') return true;
    
    // Check private
    if (addr.range() === 'private') return true;
    
    // Check link-local
    if (addr.range() === 'linkLocal') return true;
    
    // Check cloud metadata
    if (ip === '169.254.169.254') return true;
    if (ip === 'fd00:ec2::254') return true;
    
    // Check custom blocklist
    for (const range of this.blockedRanges) {
      if (range.contains(addr)) return true;
    }
    
    return false;
  }
  
  private async testConnection(url: string, maxRedirects = 3): Promise<void> {
    let currentUrl = url;
    let redirectCount = 0;
    
    while (redirectCount <= maxRedirects) {
      const response = await fetch(currentUrl, {
        method: 'HEAD',
        redirect: 'manual',
        timeout: 10000
      });
      
      if (response.status >= 300 && response.status < 400) {
        // Handle redirect
        const location = response.headers.get('location');
        if (!location) break;
        
        // Re-validate redirect URL
        const redirectValidation = await this.validate(location);
        if (!redirectValidation.valid) {
          throw new Error(`Redirect blocked: ${redirectValidation.reason}`);
        }
        
        currentUrl = location;
        redirectCount++;
      } else {
        // Success or non-redirect response
        break;
      }
    }
    
    if (redirectCount > maxRedirects) {
      throw new Error('Too many redirects');
    }
  }
}
```

## Testing Strategy

### Unit Tests
- Routing algorithm with synthetic fixtures
- Admissibility filter edge cases
- Ordering strategies
- Budget enforcement logic
- Idempotency key handling
- SSRF validation with known malicious inputs

### Integration Tests
- End-to-end route planning
- Task execution with mock providers
- OAuth flow simulation
- Audit log correctness

### Security Tests
- Credential isolation (never leaked)
- SSRF protection (all attack vectors)
- Tenant isolation (cross-account access blocked)
- Budget bypass attempts

### Contract Tests
- MCP tool request/response validation
- Type safety for all contracts
- Error response consistency

## Performance Optimization

### Caching Strategy
- Model catalog: 5-minute TTL
- Route availability: 1-minute TTL
- Budget quotas: Real-time with 10-second cache
- Connection health: 30-second cache

### Database Optimization
- Indexes on high-volume queries
- Connection pooling
- Read replicas for audit logs
- Partitioning for time-series data

### Async Operations
- Task execution: Fire-and-forget with status polling
- Usage reconciliation: Background job
- Audit log writes: Async queue

## Deployment

### Environment Variables
```bash
# Database
DATABASE_URL=postgresql://...
DATABASE_POOL_SIZE=20

# KMS
KMS_KEY_ID=arn:aws:kms:...
KMS_REGION=us-east-1

# OAuth
OAUTH_CLIENT_ID=...
OAUTH_REDIRECT_URI=https://...

# Monitoring
LOG_LEVEL=info
AUDIT_LOG_DESTINATION=...
```

### Secrets Management
- No secrets in code or config files
- Environment variables or secret manager
- Rotation procedures documented
- Access audited

### Health Checks
- `/health`: Basic liveness
- `/health/ready`: Readiness (DB connection, KMS access)
- `/health/dependencies`: Provider status

### Observability
- Structured logs (JSON)
- Metrics: task count, cost, latency, error rate
- Traces: Request spans through routing pipeline
- Alerts: Budget violations, SSRF attempts, error spikes
