/**
 * Core domain types for GPTRouter.
 * 
 * Security: NO raw credentials should ever appear in these types.
 * All credential references are opaque strings.
 */

// ============================================================================
// Common Types
// ============================================================================

export type ConnectionType = 'provider' | 'gateway';
export type RouteType = 'provider' | 'gateway';
export type ConnectionStatus = 'active' | 'revoked' | 'expired' | 'error';
export type AvailabilityStatus = 'available' | 'unavailable' | 'degraded';
export type TaskStatus = 'planning' | 'approved' | 'executing' | 'completed' | 'failed' | 'cancelled';
export type ExecutionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancel_requested' | 'cancelled';
export type OrderingStrategy = 'cost' | 'quality' | 'latency' | 'custom';

export type RejectionReasonCode =
  | 'insufficient_capability'
  | 'unavailable'
  | 'policy_violation'
  | 'budget_exceeded'
  | 'security_policy'
  | 'manual_override_invalid';

// ============================================================================
// Account & Identity
// ============================================================================

export interface Account {
  account_id: string;
  issuer: string;  // OAuth/OIDC issuer
  subject: string;  // OAuth/OIDC subject
  created_at: Date;
}

// ============================================================================
// Connections (NEVER contain raw credentials)
// ============================================================================

export interface ProviderConnection {
  type: 'provider';
  connection_id: string;
  account_id: string;
  provider: string;  // 'openai', 'anthropic', 'google', etc. (NOT hardcoded enum)
  status: ConnectionStatus;
  credential_reference: string;  // Opaque reference, NEVER the actual credential
  created_at: Date;
  updated_at: Date;
}

export interface GatewayConnection {
  type: 'gateway';
  connection_id: string;
  account_id: string;
  gateway_url: string;  // HTTPS, SSRF-validated
  gateway_type: string;  // 'openrouter', '9router', etc.
  status: ConnectionStatus;
  credential_reference: string;  // Opaque reference, NEVER the actual credential
  created_at: Date;
  updated_at: Date;
}

export type Connection = ProviderConnection | GatewayConnection;

// ============================================================================
// Model & Routing
// ============================================================================

export interface PricingInfo {
  input_cost_per_1k_tokens: number;
  output_cost_per_1k_tokens: number;
  metadata_version: string;
  effective_at: Date;
}

export interface ModelMetadata {
  model_id: string;  // NO hardcoded production model names
  capabilities: string[];
  pricing: PricingInfo;
  metadata_version: string;
  source: string;
  effective_at: Date;
  refreshed_at: Date;
}

export interface ModelRoute {
  route_id: string;
  route_type: RouteType;
  connection_id: string;
  source_id: string;  // Model identifier
  capabilities: string[];
  pricing_metadata_version: string;
  pricing: PricingInfo;
  availability_status: AvailabilityStatus;
  created_at: Date;
  updated_at: Date;
}

// ============================================================================
// Routing Policy
// ============================================================================

export interface AdmissibilityRules {
  allowed_route_types?: RouteType[];
  allowed_providers?: string[];
  blocked_providers?: string[];
  required_capabilities?: string[];
  excluded_capabilities?: string[];
}

export interface BudgetConstraints {
  free_only?: boolean;
  max_cost_per_task?: number;
  daily_cap?: number;
  monthly_cap?: number;
  premium_escalation_allowed?: boolean;
}

export interface RoutingPolicy {
  policy_id: string;
  account_id: string;
  name: string;
  ordering_strategy: OrderingStrategy;
  admissibility_rules: AdmissibilityRules;
  budget_constraints: BudgetConstraints;
  manual_override_allowed: boolean;
  version: number;
  created_at: Date;
  updated_at: Date;
}

// ============================================================================
// Task & Execution
// ============================================================================

export interface TaskRequirements {
  capabilities: string[];
  context?: Record<string, unknown>;
}

export interface Task {
  task_id: string;
  account_id: string;
  description: string;
  requirements: TaskRequirements;
  status: TaskStatus;
  created_at: Date;
}

export interface RouteSnapshot {
  route_id: string;
  route_type: RouteType;
  connection_id: string;
  source_id: string;
  pricing_metadata_version: string;
  pricing: PricingInfo;
}

export interface RejectionReason {
  route_id: string;
  reason_code: RejectionReasonCode;
  details: string;
}

export interface RoutingDecision {
  decision_id: string;
  task_id: string;
  policy_id: string;
  policy_version: number;
  evaluated_routes: string[];  // route IDs
  admissible_routes: string[];  // route IDs
  selected_route_id: string | null;
  route_snapshot: RouteSnapshot | null;
  rejection_reasons: RejectionReason[];
  estimated_cost: number | null;
  decided_at: Date;
}

export interface RetryPolicy {
  max_retries: number;
  backoff_multiplier: number;
  initial_delay_ms: number;
}

export interface ExecutionAttempt {
  attempt_id: string;
  task_id: string;
  decision_id: string;
  idempotency_key: string;
  status: ExecutionStatus;
  started_at: Date | null;
  completed_at: Date | null;
  cancel_requested_at: Date | null;
  cancelled_at: Date | null;
  retry_count: number;
  retry_policy: RetryPolicy | null;
  created_at: Date;
}

export interface UsageRecord {
  usage_id: string;
  attempt_id: string;
  provider_usage_data: Record<string, unknown>;
  actual_cost: number;
  cost_breakdown: Record<string, unknown>;
  tokens_used: {
    input: number;
    output: number;
  } | null;
  reconciled_at: Date;
  cost_variance: number | null;  // actual - estimated
}

// ============================================================================
// Audit
// ============================================================================

export interface AuditEvent {
  event_id: string;
  account_id: string | null;
  event_type: string;
  actor: string;
  resource_type: string | null;
  resource_id: string | null;
  metadata: Record<string, unknown>;  // NEVER contains credentials
  timestamp: Date;
}

// ============================================================================
// Validation Results
// ============================================================================

export interface ValidationResult {
  valid: boolean;
  reason?: string;
  details?: Record<string, unknown>;
}

export interface BudgetCheckResult {
  allowed: boolean;
  reason?: string;
  remaining_daily?: number;
  remaining_monthly?: number;
}
