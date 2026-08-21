/**
 * Convert between Drizzle row types and domain types.
 * Security: NO credential material is ever written to or read from these converters.
 */

import type {
  Account,
  AccountMembership,
  AuditEvent,
  Connection,
  ExecutionAttempt,
  GatewayConnection,
  ModelMetadata,
  ModelRoute,
  Principal,
  ProviderConnection,
  PricingInfo,
  RejectionReason,
  RetryPolicy,
  RouteSnapshot,
  RoutingDecision,
  RoutingPolicy,
  Task,
  UsageRecord,
} from '@gptrouter/contracts';

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

// ============================================================================
// Principal
// ============================================================================

export function rowToPrincipal(row: {
  principal_id: string;
  issuer: string;
  subject: string;
  host: string | null;
  created_at: string;
  updated_at: string;
}): Principal {
  return {
    principal_id: row.principal_id,
    issuer: row.issuer,
    subject: row.subject,
    host: row.host ?? undefined,
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
  };
}

// ============================================================================
// Account
// ============================================================================

export function rowToAccount(row: {
  account_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}): Account {
  return {
    account_id: row.account_id,
    name: row.name,
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
  };
}

// ============================================================================
// Membership
// ============================================================================

export function rowToMembership(row: {
  membership_id: string;
  account_id: string;
  principal_id: string;
  role: string;
  status: string;
  created_at: string;
  updated_at: string;
}): AccountMembership {
  return {
    membership_id: row.membership_id,
    account_id: row.account_id,
    principal_id: row.principal_id,
    role: row.role as AccountMembership['role'],
    status: row.status as AccountMembership['status'],
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
  };
}

// ============================================================================
// Connection
// ============================================================================

export function rowToConnection(row: {
  connection_id: string;
  account_id: string;
  type: string;
  provider: string | null;
  gateway_url: string | null;
  gateway_type: string | null;
  status: string;
  credential_reference: string;
  created_at: string;
  updated_at: string;
}): Connection {
  if (row.type === 'gateway') {
    const conn: GatewayConnection = {
      type: 'gateway',
      connection_id: row.connection_id,
      account_id: row.account_id,
      gateway_url: row.gateway_url ?? '',
      gateway_type: row.gateway_type ?? '',
      status: row.status as Connection['status'],
      credential_reference: row.credential_reference,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
    };
    return conn;
  }
  const conn: ProviderConnection = {
    type: 'provider',
    connection_id: row.connection_id,
    account_id: row.account_id,
    provider: row.provider ?? '',
    status: row.status as Connection['status'],
    credential_reference: row.credential_reference,
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
  };
  return conn;
}

// ============================================================================
// PricingInfo (stored as flat columns)
// ============================================================================

export function rowToPricing(row: {
  pricing_input: number;
  pricing_output: number;
  pricing_currency: string;
  pricing_units: string;
  pricing_source: string;
  pricing_effective_at: string;
  pricing_refreshed_at: string;
  pricing_version: string;
}): PricingInfo {
  return {
    input_cost_per_1k_tokens: row.pricing_input,
    output_cost_per_1k_tokens: row.pricing_output,
    currency: row.pricing_currency,
    units: row.pricing_units,
    source: row.pricing_source,
    effective_at: new Date(row.pricing_effective_at),
    refreshed_at: new Date(row.pricing_refreshed_at),
    version: row.pricing_version,
  };
}

// ============================================================================
// ModelRoute
// ============================================================================

export function rowToRoute(row: {
  route_id: string;
  route_type: string;
  connection_id: string;
  source_id: string;
  source_provider: string | null;
  source_gateway: string | null;
  capabilities: string;
  pricing_input: number;
  pricing_output: number;
  pricing_currency: string;
  pricing_units: string;
  pricing_source: string;
  pricing_effective_at: string;
  pricing_refreshed_at: string;
  pricing_version: string;
  availability_status: string;
  created_at: string;
  updated_at: string;
}): ModelRoute {
  return {
    route_id: row.route_id,
    route_type: row.route_type as ModelRoute['route_type'],
    connection_id: row.connection_id,
    source_id: row.source_id,
    source_provider: row.source_provider ?? undefined,
    source_gateway: row.source_gateway ?? undefined,
    capabilities: parseJson<string[]>(row.capabilities, []),
    pricing: rowToPricing(row),
    availability_status: row.availability_status as ModelRoute['availability_status'],
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
  };
}

// ============================================================================
// RoutingPolicy
// ============================================================================

export function rowToPolicy(row: {
  policy_id: string;
  account_id: string;
  name: string;
  ordering_strategy: string;
  admissibility_rules: string;
  budget_constraints: string;
  retry_policy: string | null;
  manual_override_allowed: boolean | number;
  version: number;
  created_at: string;
  updated_at: string;
}): RoutingPolicy {
  return {
    policy_id: row.policy_id,
    account_id: row.account_id,
    name: row.name,
    ordering_strategy: row.ordering_strategy as RoutingPolicy['ordering_strategy'],
    admissibility_rules: parseJson(row.admissibility_rules, {}),
    budget_constraints: parseJson(row.budget_constraints, {}),
    retry_policy: row.retry_policy
      ? parseJson<RetryPolicy>(row.retry_policy, null as unknown as RetryPolicy)
      : undefined,
    manual_override_allowed: Boolean(row.manual_override_allowed),
    version: row.version,
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
  };
}

// ============================================================================
// Task
// ============================================================================

export function rowToTask(row: {
  task_id: string;
  account_id: string;
  description: string;
  requirements: string;
  status: string;
  created_at: string;
}): Task {
  return {
    task_id: row.task_id,
    account_id: row.account_id,
    description: row.description,
    requirements: parseJson(row.requirements, { capabilities: [] }),
    status: row.status as Task['status'],
    created_at: new Date(row.created_at),
  };
}

// ============================================================================
// RoutingDecision
// ============================================================================

export function rowToDecision(row: {
  decision_id: string;
  task_id: string;
  policy_id: string;
  policy_version: number;
  evaluated_routes: string;
  admissible_routes: string;
  selected_route_id: string | null;
  route_snapshot: string | null;
  rejection_reasons: string;
  estimated_cost: number | null;
  decided_at: string;
  parent_decision_id: string | null;
  fallback_reason: string | null;
  ordering_strategy_unsupported: boolean | number | null;
}): RoutingDecision {
  return {
    decision_id: row.decision_id,
    task_id: row.task_id,
    policy_id: row.policy_id,
    policy_version: row.policy_version,
    evaluated_routes: parseJson<string[]>(row.evaluated_routes, []),
    admissible_routes: parseJson<string[]>(row.admissible_routes, []),
    selected_route_id: row.selected_route_id ?? null,
    route_snapshot: row.route_snapshot
      ? parseJson<RouteSnapshot>(row.route_snapshot, null as unknown as RouteSnapshot)
      : null,
    rejection_reasons: parseJson<RejectionReason[]>(row.rejection_reasons, []),
    estimated_cost: row.estimated_cost,
    decided_at: new Date(row.decided_at),
    parent_decision_id: row.parent_decision_id ?? null,
    fallback_reason: row.fallback_reason ?? null,
    ordering_strategy_unsupported: Boolean(row.ordering_strategy_unsupported),
  };
}

// ============================================================================
// ExecutionAttempt
// ============================================================================

export function rowToAttempt(row: {
  attempt_id: string;
  account_id: string;
  execution_id: string;
  task_id: string;
  decision_id: string;
  idempotency_key: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  cancel_requested_at: string | null;
  cancelled_at: string | null;
  retry_count: number;
  retry_policy: string | null;
  parent_attempt_id: string | null;
  verification_outcome: string | null;
  failure_code: string | null;
  created_at: string;
}): ExecutionAttempt {
  return {
    attempt_id: row.attempt_id,
    account_id: row.account_id,
    execution_id: row.execution_id,
    task_id: row.task_id,
    decision_id: row.decision_id,
    idempotency_key: row.idempotency_key,
    status: row.status as ExecutionAttempt['status'],
    started_at: row.started_at ? new Date(row.started_at) : null,
    completed_at: row.completed_at ? new Date(row.completed_at) : null,
    cancel_requested_at: row.cancel_requested_at ? new Date(row.cancel_requested_at) : null,
    cancelled_at: row.cancelled_at ? new Date(row.cancelled_at) : null,
    retry_count: row.retry_count,
    retry_policy: row.retry_policy
      ? parseJson<RetryPolicy>(row.retry_policy, null as unknown as RetryPolicy)
      : null,
    parent_attempt_id: row.parent_attempt_id ?? null,
    verification_outcome:
      (row.verification_outcome as ExecutionAttempt['verification_outcome']) ?? null,
    failure_code: row.failure_code ?? null,
    created_at: new Date(row.created_at),
  };
}

// ============================================================================
// UsageRecord
// ============================================================================

export function rowToUsage(row: {
  usage_id: string;
  account_id: string;
  attempt_id: string;
  provider_usage_data: string;
  actual_cost: number | null;
  cost_breakdown: string;
  input_tokens: number | null;
  output_tokens: number | null;
  reconciled_at: string;
  cost_variance: number | null;
}): UsageRecord {
  return {
    usage_id: row.usage_id,
    account_id: row.account_id,
    attempt_id: row.attempt_id,
    provider_usage_data: parseJson(row.provider_usage_data, {}),
    actual_cost: row.actual_cost,
    cost_breakdown: parseJson(row.cost_breakdown, {}),
    tokens_used:
      row.input_tokens !== null && row.output_tokens !== null
        ? { input: row.input_tokens, output: row.output_tokens }
        : null,
    reconciled_at: new Date(row.reconciled_at),
    cost_variance: row.cost_variance,
  };
}

// ============================================================================
// AuditEvent
// ============================================================================

export function rowToAudit(row: {
  event_id: string;
  account_id: string | null;
  event_type: string;
  actor: string;
  resource_type: string | null;
  resource_id: string | null;
  metadata: string;
  timestamp: string;
}): AuditEvent {
  return {
    event_id: row.event_id,
    account_id: row.account_id ?? null,
    event_type: row.event_type,
    actor: row.actor,
    resource_type: row.resource_type ?? null,
    resource_id: row.resource_id ?? null,
    metadata: parseJson(row.metadata, {}),
    timestamp: new Date(row.timestamp),
  };
}

// ============================================================================
// ModelMetadata
// ============================================================================

export function rowToModelMetadata(row: {
  model_id: string;
  capabilities: string;
  pricing_input: number;
  pricing_output: number;
  pricing_currency: string;
  pricing_units: string;
  pricing_source: string;
  pricing_effective_at: string;
  pricing_refreshed_at: string;
  pricing_version: string;
  source: string;
  effective_at: string;
  refreshed_at: string;
  version: string;
}): ModelMetadata {
  return {
    model_id: row.model_id,
    capabilities: parseJson<string[]>(row.capabilities, []),
    pricing: rowToPricing(row),
    source: row.source,
    effective_at: new Date(row.effective_at),
    refreshed_at: new Date(row.refreshed_at),
    version: row.version,
  };
}
