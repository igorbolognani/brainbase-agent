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
export type TaskStatus =
  'planning' | 'approved' | 'executing' | 'completed' | 'failed' | 'cancelled';
export type ExecutionStatus =
  'pending' | 'running' | 'completed' | 'failed' | 'cancel_requested' | 'cancelled';
export type OrderingStrategy = 'cost' | 'quality' | 'latency' | 'custom';
export type OrderingStatus = 'operational' | 'unsupported';

/**
 * Performance metadata for quality/latency ordering
 * Only present when valid evidence-backed metrics exist
 */
export interface RoutePerformanceMetadata {
  route_id: string;
  quality_score?: number; // 0-1, higher is better
  avg_latency_ms?: number; // Average latency in milliseconds
  p95_latency_ms?: number; // P95 latency
  source: string; // Where this data came from
  effective_at: Date;
  refreshed_at: Date;
  version: string;
  sample_size: number; // Number of observations
}

export type RejectionReasonCode =
  | 'insufficient_capability'
  | 'unavailable'
  | 'policy_violation_route_type'
  | 'policy_violation_provider_blocked'
  | 'policy_violation_provider_not_allowed'
  | 'policy_violation_gateway_blocked'
  | 'policy_violation_gateway_not_allowed'
  | 'policy_violation_excluded_capability'
  | 'policy_violation_security'
  | 'budget_exceeded_per_task'
  | 'budget_exceeded_daily'
  | 'budget_exceeded_monthly'
  | 'budget_exceeded_route_class'
  | 'manual_override_invalid';

// ============================================================================
// Account & Identity
// ============================================================================

/**
 * Principal: User identity from OAuth/OIDC (GPTRouter's own authentication)
 */
export interface Principal {
  principal_id: string;
  issuer: string; // OAuth/OIDC issuer (e.g., ChatGPT, OpenAI Platform)
  subject: string; // OAuth/OIDC subject (user ID from issuer)
  host?: string; // Optional, non-authoritative unless official docs guarantee it
  created_at: Date;
  updated_at: Date;
}

/**
 * Account: Tenant/ownership boundary for resources
 */
export interface Account {
  account_id: string;
  name: string;
  created_at: Date;
  updated_at: Date;
}

/**
 * AccountMembership: Links principals (users) to accounts with roles
 */
export type MembershipRole = 'owner' | 'admin' | 'member' | 'viewer';
export type MembershipStatus = 'active' | 'suspended' | 'revoked';

export interface AccountMembership {
  membership_id: string;
  account_id: string;
  principal_id: string;
  role: MembershipRole;
  status: MembershipStatus;
  created_at: Date;
  updated_at: Date;
}

// ============================================================================
// Connections (NEVER contain raw credentials)
// ============================================================================

export interface ProviderConnection {
  type: 'provider';
  connection_id: string;
  account_id: string;
  provider: string; // 'openai', 'anthropic', 'google', etc. (NOT hardcoded enum)
  status: ConnectionStatus;
  credential_reference: string; // Opaque reference, NEVER the actual credential
  created_at: Date;
  updated_at: Date;
}

export interface GatewayConnection {
  type: 'gateway';
  connection_id: string;
  account_id: string;
  gateway_url: string; // HTTPS, SSRF-validated
  gateway_type: string; // 'openrouter', '9router', etc.
  status: ConnectionStatus;
  credential_reference: string; // Opaque reference, NEVER the actual credential
  created_at: Date;
  updated_at: Date;
}

export type Connection = ProviderConnection | GatewayConnection;

// ============================================================================
// Provider & Gateway Catalog (Dynamic, NOT hardcoded)
// ============================================================================

export type AuthMethod = 'oauth' | 'secure_secret_setup' | 'none';

export interface ProviderMetadata {
  provider_id: string; // e.g., 'openai', 'anthropic', 'google'
  display_name: string;
  supported_auth_methods: AuthMethod[];
  base_url?: string;
  documentation_url?: string;
  created_at: Date;
  updated_at: Date;
}

export interface GatewayMetadata {
  gateway_id: string; // e.g., 'openrouter', '9router'
  display_name: string;
  supported_auth_methods: AuthMethod[];
  requires_https: boolean;
  documentation_url?: string;
  created_at: Date;
  updated_at: Date;
}

/**
 * Result of initiating a provider/gateway connection
 * NEVER includes raw credentials in any field
 */
export interface ConnectionSetupResult {
  connection_id: string; // Opaque connection ID
  setup_method: AuthMethod;
  status: 'pending' | 'awaiting_oauth' | 'active' | 'error';
  authorization_url?: string; // Only present for OAuth flows
  error_message?: string;
}

// ============================================================================
// Model & Routing
// ============================================================================

export interface PricingInfo {
  input_cost_per_1k_tokens: number;
  output_cost_per_1k_tokens: number;
  currency: string; // e.g., 'USD'
  units: string; // e.g., 'per_1k_tokens'
  source: string; // Where this pricing came from (e.g., 'openai-api', 'openrouter-api', 'manual')
  effective_at: Date;
  refreshed_at: Date;
  version: string; // Version identifier for this pricing snapshot
}

export interface ModelMetadata {
  model_id: string; // NO hardcoded production model names
  capabilities: string[];
  pricing: PricingInfo;
  source: string; // Provenance: where this metadata came from
  effective_at: Date;
  refreshed_at: Date;
  version: string; // Metadata version for tracking
}

export interface ModelRoute {
  route_id: string;
  route_type: RouteType;
  connection_id: string;
  source_id: string; // Model identifier (e.g., 'gpt-4', 'claude-3-opus')
  source_provider?: string; // Provider identity for this route (e.g., 'openai', 'anthropic')
  source_gateway?: string; // Gateway identity if route_type is 'gateway' (e.g., 'openrouter', '9router')
  capabilities: string[];
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
  allowed_providers?: string[]; // Allowed provider IDs
  blocked_providers?: string[]; // Blocked provider IDs
  allowed_gateways?: string[]; // Allowed gateway types
  blocked_gateways?: string[]; // Blocked gateway types
  required_capabilities?: string[];
  excluded_capabilities?: string[];
  require_https?: boolean; // Security: require HTTPS for gateways
}

export interface BudgetConstraints {
  free_only?: boolean;
  max_cost_per_task?: number;
  daily_cap?: number;
  monthly_cap?: number;
  allowed_route_classes?: string[]; // e.g., ['free', 'standard', 'premium']
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
  source_provider?: string;
  source_gateway?: string;
  pricing: PricingInfo;
  policy_version: number; // Policy version at decision time
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
  evaluated_routes: string[]; // route IDs
  admissible_routes: string[]; // route IDs
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
  cost_variance: number | null; // actual - estimated
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
  metadata: Record<string, unknown>; // NEVER contains credentials
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
