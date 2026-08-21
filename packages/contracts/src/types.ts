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
export type VerificationOutcome = 'accepted' | 'retryable_failure' | 'terminal_failure';
export type OrderingStrategy = 'cost' | 'quality' | 'latency' | 'balanced' | 'custom';
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
  | 'budget_exceeded_insufficient_balance'
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

/**
 * The only identity context accepted by consequential application services.
 * It is produced after verified authentication and account authorization; raw
 * access tokens are deliberately absent.
 */
export interface AuthorizedExecutionContext {
  principal: Principal;
  account: Account;
  membership: AccountMembership;
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
  retry_policy?: RetryPolicy;
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
  /** Immutable provenance link when this decision was created by fallback. */
  parent_decision_id?: string | null;
  fallback_reason?: string | null;
  /**
   * Indicates if the requested ordering strategy is unsupported.
   * When true, no route was selected even if admissible routes exist.
   */
  ordering_strategy_unsupported?: boolean;
}

export interface RetryPolicy {
  max_retries: number;
  backoff_multiplier: number;
  initial_delay_ms: number;
  /** Failure classes eligible for retry; an empty list means all retryable outcomes. */
  retryable_failure_codes?: string[];
  /** Whether a new route may be selected after same-route retry exhaustion. */
  fallback_enabled?: boolean;
  /** Maximum number of fallback decisions for one execution request. */
  max_fallbacks?: number;
  /** Aggregate planned-cost ceiling across all attempts and fallback decisions. */
  max_total_estimated_cost?: number | null;
}

export interface Execution {
  execution_id: string;
  account_id: string;
  task_id: string;
  root_decision_id: string;
  idempotency_key: string;
  /** Stable hash of the normalized root execution command. */
  command_fingerprint?: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  created_at: Date;
}

export interface ExecutionAttempt {
  attempt_id: string;
  account_id: string;
  /** Stable execution-request identity shared by retry/fallback attempts. */
  execution_id: string;
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
  parent_attempt_id: string | null;
  verification_outcome: VerificationOutcome | null;
  failure_code: string | null;
  created_at: Date;
}

export interface UsageRecord {
  usage_id: string;
  account_id: string;
  attempt_id: string;
  provider_usage_data: Record<string, unknown>;
  actual_cost: number | null;
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

// ============================================================================
// Phase 4: Model Offering Catalog
// ============================================================================

export type HealthState = 'healthy' | 'degraded' | 'unavailable' | 'disabled';

export interface ModelOffering {
  offering_id: string;
  provider: string;
  model_id: string;
  display_name: string;
  capabilities: string[];
  context_window: number | null;
  max_output_tokens: number | null;
  supports_tools: boolean;
  supports_vision: boolean;
  supports_audio: boolean;
  supports_structured_output: boolean;
  supports_reasoning: boolean;
  pricing: PricingInfo;
  availability_status: AvailabilityStatus;
  health_state: HealthState;
  effective_at: Date;
  refreshed_at: Date;
  version: string;
}

// ============================================================================
// Phase 4: Quality Evidence
// ============================================================================

export interface ModelQualityEvidence {
  evidence_id: string;
  offering_id: string;
  evidence_type: 'benchmark' | 'evaluation' | 'human_annotation' | 'synthetic';
  benchmark: string;
  domain: string;
  task_family: string;
  score: number;
  score_scale: string;
  higher_is_better: boolean;
  sample_size: number;
  source: string;
  source_reference: string;
  measured_at: Date;
  ingested_at: Date;
  version: string;
  confidence: number;
}

// ============================================================================
// Phase 4: Routing Scoring
// ============================================================================

export interface RoutingScore {
  route_id: string;
  total_score: number;
  cost_score: number;
  quality_score: number;
  health_penalty: number;
  reasons: string[];
}

export interface RoutingExplanation {
  selected_route_id: string | null;
  strategy: OrderingStrategy;
  scores: RoutingScore[];
  admissibility_rejections: RejectionReason[];
  estimated_cost: number | null;
  health_states: Record<string, HealthState>;
  unknown_evidence: string[];
}

// ============================================================================
// Phase 5: Orchestration Graph
// ============================================================================

export type OrchestrationMode =
  'single' | 'fallback' | 'parallel_candidates' | 'planner_worker_reviewer';
export type OrchestrationNodeRole =
  'root' | 'worker' | 'planner' | 'reviewer' | 'judge' | 'candidate';
export type OrchestrationNodeStatus =
  'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'skipped';

export interface OrchestrationGraph {
  graph_id: string;
  execution_id: string;
  account_id: string;
  task_id: string;
  mode: OrchestrationMode;
  status: OrchestrationNodeStatus;
  max_nodes: number;
  max_parallel: number;
  created_at: Date;
  updated_at: Date;
}

export interface OrchestrationNode {
  node_id: string;
  graph_id: string;
  parent_node_id: string | null;
  role: OrchestrationNodeRole;
  execution_id: string | null;
  decision_id: string | null;
  status: OrchestrationNodeStatus;
  sort_order: number;
  created_at: Date;
  updated_at: Date;
}
