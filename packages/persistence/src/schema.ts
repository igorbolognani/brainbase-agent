import { sqliteTable, text, integer, real, uniqueIndex, index } from 'drizzle-orm/sqlite-core';

export const principals = sqliteTable(
  'principals',
  {
    principal_id: text('principal_id').primaryKey(),
    issuer: text('issuer').notNull(),
    subject: text('subject').notNull(),
    host: text('host'),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('principals_issuer_subject').on(t.issuer, t.subject),
    index('principals_issuer').on(t.issuer),
    index('principals_subject').on(t.subject),
  ]
);

export const accounts = sqliteTable('accounts', {
  account_id: text('account_id').primaryKey(),
  name: text('name').notNull(),
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull(),
});

export const account_memberships = sqliteTable(
  'account_memberships',
  {
    membership_id: text('membership_id').primaryKey(),
    account_id: text('account_id')
      .notNull()
      .references(() => accounts.account_id),
    principal_id: text('principal_id')
      .notNull()
      .references(() => principals.principal_id),
    role: text('role').notNull(),
    status: text('status').notNull(),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('membership_account_principal').on(t.account_id, t.principal_id),
    index('membership_principal').on(t.principal_id),
    index('membership_account').on(t.account_id),
  ]
);

export const connections = sqliteTable(
  'connections',
  {
    connection_id: text('connection_id').primaryKey(),
    account_id: text('account_id')
      .notNull()
      .references(() => accounts.account_id),
    type: text('type').notNull(),
    provider: text('provider'),
    gateway_url: text('gateway_url'),
    gateway_type: text('gateway_type'),
    status: text('status').notNull(),
    credential_reference: text('credential_reference').notNull(),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
  },
  (t) => [
    index('connections_account').on(t.account_id),
    index('connections_type').on(t.type),
    index('connections_status').on(t.status),
  ]
);

export const model_routes = sqliteTable(
  'model_routes',
  {
    route_id: text('route_id').primaryKey(),
    route_type: text('route_type').notNull(),
    connection_id: text('connection_id')
      .notNull()
      .references(() => connections.connection_id),
    source_id: text('source_id').notNull(),
    source_provider: text('source_provider'),
    source_gateway: text('source_gateway'),
    capabilities: text('capabilities').notNull(),
    pricing_input: real('pricing_input').notNull(),
    pricing_output: real('pricing_output').notNull(),
    pricing_currency: text('pricing_currency').notNull().default('USD'),
    pricing_units: text('pricing_units').notNull().default('per_1k_tokens'),
    pricing_source: text('pricing_source').notNull(),
    pricing_effective_at: text('pricing_effective_at').notNull(),
    pricing_refreshed_at: text('pricing_refreshed_at').notNull(),
    pricing_version: text('pricing_version').notNull(),
    pricing_status: text('pricing_status').notNull().default('unknown'),
    availability_status: text('availability_status').notNull(),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
  },
  (t) => [
    index('routes_connection').on(t.connection_id),
    index('routes_source_id').on(t.source_id),
    index('routes_availability').on(t.availability_status),
  ]
);

export const routing_policies = sqliteTable(
  'routing_policies',
  {
    policy_id: text('policy_id').primaryKey(),
    account_id: text('account_id')
      .notNull()
      .references(() => accounts.account_id),
    name: text('name').notNull(),
    ordering_strategy: text('ordering_strategy').notNull(),
    admissibility_rules: text('admissibility_rules').notNull(),
    budget_constraints: text('budget_constraints').notNull(),
    retry_policy: text('retry_policy'),
    manual_override_allowed: integer('manual_override_allowed', { mode: 'boolean' })
      .notNull()
      .default(false),
    version: integer('version').notNull().default(1),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
  },
  (t) => [index('policies_account').on(t.account_id)]
);

export const tasks = sqliteTable(
  'tasks',
  {
    task_id: text('task_id').primaryKey(),
    account_id: text('account_id')
      .notNull()
      .references(() => accounts.account_id),
    description: text('description').notNull(),
    requirements: text('requirements').notNull(),
    status: text('status').notNull(),
    created_at: text('created_at').notNull(),
  },
  (t) => [index('tasks_account').on(t.account_id), index('tasks_status').on(t.status)]
);

export const routing_decisions = sqliteTable(
  'routing_decisions',
  {
    decision_id: text('decision_id').primaryKey(),
    task_id: text('task_id')
      .notNull()
      .references(() => tasks.task_id),
    policy_id: text('policy_id')
      .notNull()
      .references(() => routing_policies.policy_id),
    policy_version: integer('policy_version').notNull(),
    evaluated_routes: text('evaluated_routes').notNull(),
    admissible_routes: text('admissible_routes').notNull(),
    selected_route_id: text('selected_route_id'),
    route_snapshot: text('route_snapshot'),
    rejection_reasons: text('rejection_reasons').notNull(),
    estimated_cost: real('estimated_cost'),
    decided_at: text('decided_at').notNull(),
    parent_decision_id: text('parent_decision_id'),
    fallback_reason: text('fallback_reason'),
    ordering_strategy_unsupported: integer('ordering_strategy_unsupported', { mode: 'boolean' }),
  },
  (t) => [
    index('decisions_task').on(t.task_id),
    index('decisions_policy').on(t.policy_id),
    index('decisions_decided_at').on(t.decided_at),
  ]
);

export const executions = sqliteTable(
  'executions',
  {
    execution_id: text('execution_id').primaryKey(),
    account_id: text('account_id')
      .notNull()
      .references(() => accounts.account_id),
    task_id: text('task_id')
      .notNull()
      .references(() => tasks.task_id),
    root_decision_id: text('root_decision_id')
      .notNull()
      .references(() => routing_decisions.decision_id),
    idempotency_key: text('idempotency_key').notNull(),
    command_fingerprint: text('command_fingerprint'),
    status: text('status').notNull(),
    created_at: text('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('executions_account_idempotency').on(t.account_id, t.idempotency_key),
    index('executions_account').on(t.account_id),
    index('executions_task').on(t.task_id),
    index('executions_status').on(t.status),
  ]
);

export const execution_attempts = sqliteTable(
  'execution_attempts',
  {
    attempt_id: text('attempt_id').primaryKey(),
    account_id: text('account_id')
      .notNull()
      .references(() => accounts.account_id),
    execution_id: text('execution_id').notNull(),
    task_id: text('task_id')
      .notNull()
      .references(() => tasks.task_id),
    decision_id: text('decision_id')
      .notNull()
      .references(() => routing_decisions.decision_id),
    idempotency_key: text('idempotency_key').notNull(),
    status: text('status').notNull(),
    started_at: text('started_at'),
    completed_at: text('completed_at'),
    cancel_requested_at: text('cancel_requested_at'),
    cancelled_at: text('cancelled_at'),
    retry_count: integer('retry_count').notNull().default(0),
    retry_policy: text('retry_policy'),
    parent_attempt_id: text('parent_attempt_id'),
    verification_outcome: text('verification_outcome'),
    failure_code: text('failure_code'),
    created_at: text('created_at').notNull(),
  },
  (t) => [
    index('attempts_execution').on(t.execution_id),
    index('attempts_task').on(t.task_id),
    index('attempts_decision').on(t.decision_id),
    index('attempts_status').on(t.status),
  ]
);

export const usage_records = sqliteTable(
  'usage_records',
  {
    usage_id: text('usage_id').primaryKey(),
    account_id: text('account_id')
      .notNull()
      .references(() => accounts.account_id),
    attempt_id: text('attempt_id')
      .notNull()
      .unique()
      .references(() => execution_attempts.attempt_id),
    provider_usage_data: text('provider_usage_data').notNull(),
    actual_cost: real('actual_cost'),
    cost_breakdown: text('cost_breakdown').notNull(),
    input_tokens: integer('input_tokens'),
    output_tokens: integer('output_tokens'),
    reconciled_at: text('reconciled_at').notNull(),
    cost_variance: real('cost_variance'),
  },
  (t) => [index('usage_account').on(t.account_id), index('usage_reconciled_at').on(t.reconciled_at)]
);

export const audit_events = sqliteTable(
  'audit_events',
  {
    event_id: text('event_id').primaryKey(),
    account_id: text('account_id'),
    event_type: text('event_type').notNull(),
    actor: text('actor').notNull(),
    resource_type: text('resource_type'),
    resource_id: text('resource_id'),
    metadata: text('metadata').notNull(),
    timestamp: text('timestamp').notNull(),
  },
  (t) => [
    index('audit_account').on(t.account_id),
    index('audit_event_type').on(t.event_type),
    index('audit_timestamp').on(t.timestamp),
    index('audit_account_timestamp').on(t.account_id, t.timestamp),
  ]
);

export const credential_references = sqliteTable(
  'credential_references',
  {
    credential_ref_id: text('credential_ref_id').primaryKey(),
    account_id: text('account_id').notNull(),
    provider: text('provider').notNull(),
    reference_key: text('reference_key').notNull(),
    auth_method: text('auth_method').notNull(),
    status: text('status').notNull().default('active'),
    rotation_at: text('rotation_at'),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
  },
  (t) => [
    index('credrefs_account').on(t.account_id),
    index('credrefs_provider').on(t.provider),
    uniqueIndex('credrefs_account_provider').on(t.account_id, t.provider),
  ]
);

// ============================================================================
// Phase 4: Model Offering Catalog
// ============================================================================

export const model_offerings = sqliteTable(
  'model_offerings',
  {
    offering_id: text('offering_id').primaryKey(),
    provider: text('provider').notNull(),
    model_id: text('model_id').notNull(),
    display_name: text('display_name').notNull(),
    capabilities: text('capabilities').notNull(),
    context_window: integer('context_window'),
    max_output_tokens: integer('max_output_tokens'),
    supports_tools: integer('supports_tools', { mode: 'boolean' }).notNull().default(false),
    supports_vision: integer('supports_vision', { mode: 'boolean' }).notNull().default(false),
    supports_audio: integer('supports_audio', { mode: 'boolean' }).notNull().default(false),
    supports_structured_output: integer('supports_structured_output', { mode: 'boolean' })
      .notNull()
      .default(false),
    supports_reasoning: integer('supports_reasoning', { mode: 'boolean' }).notNull().default(false),
    pricing_input: real('pricing_input').notNull(),
    pricing_output: real('pricing_output').notNull(),
    pricing_currency: text('pricing_currency').notNull().default('USD'),
    pricing_units: text('pricing_units').notNull().default('per_1k_tokens'),
    pricing_source: text('pricing_source').notNull(),
    pricing_effective_at: text('pricing_effective_at').notNull(),
    pricing_refreshed_at: text('pricing_refreshed_at').notNull(),
    pricing_version: text('pricing_version').notNull(),
    pricing_status: text('pricing_status').notNull().default('unknown'),
    availability_status: text('availability_status').notNull().default('available'),
    health_state: text('health_state').notNull().default('healthy'),
    effective_at: text('effective_at').notNull(),
    refreshed_at: text('refreshed_at').notNull(),
    version: text('version').notNull(),
  },
  (t) => [
    uniqueIndex('offerings_provider_model').on(t.provider, t.model_id),
    index('offerings_provider').on(t.provider),
    index('offerings_availability').on(t.availability_status),
    index('offerings_health').on(t.health_state),
  ]
);

export const model_quality_evidence = sqliteTable(
  'model_quality_evidence',
  {
    evidence_id: text('evidence_id').primaryKey(),
    offering_id: text('offering_id')
      .notNull()
      .references(() => model_offerings.offering_id),
    evidence_type: text('evidence_type').notNull(),
    benchmark: text('benchmark').notNull(),
    domain: text('domain').notNull(),
    task_family: text('task_family').notNull(),
    score: real('score').notNull(),
    score_scale: text('score_scale').notNull(),
    higher_is_better: integer('higher_is_better', { mode: 'boolean' }).notNull().default(true),
    sample_size: integer('sample_size').notNull(),
    source: text('source').notNull(),
    source_reference: text('source_reference').notNull(),
    measured_at: text('measured_at').notNull(),
    ingested_at: text('ingested_at').notNull(),
    version: text('version').notNull(),
    confidence: real('confidence').notNull(),
  },
  (t) => [
    index('evidence_offering').on(t.offering_id),
    index('evidence_benchmark').on(t.benchmark),
    index('evidence_domain').on(t.domain),
    index('evidence_task_family').on(t.task_family),
  ]
);

// ============================================================================
// Phase 5: Orchestration Graph
// ============================================================================

export const orchestration_graphs = sqliteTable(
  'orchestration_graphs',
  {
    graph_id: text('graph_id').primaryKey(),
    execution_id: text('execution_id').notNull().unique(),
    account_id: text('account_id')
      .notNull()
      .references(() => accounts.account_id),
    task_id: text('task_id')
      .notNull()
      .references(() => tasks.task_id),
    mode: text('mode').notNull(),
    status: text('status').notNull().default('pending'),
    limits: text('limits').notNull().default('{}'),
    max_nodes: integer('max_nodes').notNull().default(10),
    max_parallel: integer('max_parallel').notNull().default(4),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
  },
  (t) => [
    index('graphs_account').on(t.account_id),
    index('graphs_execution').on(t.execution_id),
    index('graphs_task').on(t.task_id),
  ]
);

export const orchestration_nodes = sqliteTable(
  'orchestration_nodes',
  {
    node_id: text('node_id').primaryKey(),
    graph_id: text('graph_id')
      .notNull()
      .references(() => orchestration_graphs.graph_id),
    parent_node_id: text('parent_node_id'),
    role: text('role').notNull(),
    execution_id: text('execution_id'),
    decision_id: text('decision_id'),
    status: text('status').notNull().default('pending'),
    sort_order: integer('sort_order').notNull().default(0),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
  },
  (t) => [
    index('nodes_graph').on(t.graph_id),
    index('nodes_execution').on(t.execution_id),
    index('nodes_status').on(t.status),
  ]
);
