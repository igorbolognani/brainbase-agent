-- GPTRouter Production Persistence Schema
-- SQLite for development/testing; swap provider+url for PostgreSQL in production.

CREATE TABLE IF NOT EXISTS "principals" (
  "principal_id" TEXT PRIMARY KEY,
  "issuer" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "host" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "principals_issuer_subject" ON "principals"("issuer", "subject");
CREATE INDEX IF NOT EXISTS "principals_issuer" ON "principals"("issuer");
CREATE INDEX IF NOT EXISTS "principals_subject" ON "principals"("subject");

CREATE TABLE IF NOT EXISTS "accounts" (
  "account_id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS "account_memberships" (
  "membership_id" TEXT PRIMARY KEY,
  "account_id" TEXT NOT NULL REFERENCES "accounts"("account_id"),
  "principal_id" TEXT NOT NULL REFERENCES "principals"("principal_id"),
  "role" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "membership_account_principal" ON "account_memberships"("account_id", "principal_id");
CREATE INDEX IF NOT EXISTS "membership_principal" ON "account_memberships"("principal_id");
CREATE INDEX IF NOT EXISTS "membership_account" ON "account_memberships"("account_id");

CREATE TABLE IF NOT EXISTS "connections" (
  "connection_id" TEXT PRIMARY KEY,
  "account_id" TEXT NOT NULL REFERENCES "accounts"("account_id"),
  "type" TEXT NOT NULL,
  "provider" TEXT,
  "gateway_url" TEXT,
  "gateway_type" TEXT,
  "status" TEXT NOT NULL,
  "credential_reference" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS "connections_account" ON "connections"("account_id");
CREATE INDEX IF NOT EXISTS "connections_type" ON "connections"("type");
CREATE INDEX IF NOT EXISTS "connections_status" ON "connections"("status");

CREATE TABLE IF NOT EXISTS "model_routes" (
  "route_id" TEXT PRIMARY KEY,
  "route_type" TEXT NOT NULL,
  "connection_id" TEXT NOT NULL REFERENCES "connections"("connection_id"),
  "source_id" TEXT NOT NULL,
  "source_provider" TEXT,
  "source_gateway" TEXT,
  "capabilities" TEXT NOT NULL,
  "pricing_input" REAL NOT NULL,
  "pricing_output" REAL NOT NULL,
  "pricing_currency" TEXT NOT NULL DEFAULT 'USD',
  "pricing_units" TEXT NOT NULL DEFAULT 'per_1k_tokens',
  "pricing_source" TEXT NOT NULL,
  "pricing_effective_at" TEXT NOT NULL,
  "pricing_refreshed_at" TEXT NOT NULL,
  "pricing_version" TEXT NOT NULL,
  "availability_status" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS "routes_connection" ON "model_routes"("connection_id");
CREATE INDEX IF NOT EXISTS "routes_source_id" ON "model_routes"("source_id");
CREATE INDEX IF NOT EXISTS "routes_availability" ON "model_routes"("availability_status");

CREATE TABLE IF NOT EXISTS "routing_policies" (
  "policy_id" TEXT PRIMARY KEY,
  "account_id" TEXT NOT NULL REFERENCES "accounts"("account_id"),
  "name" TEXT NOT NULL,
  "ordering_strategy" TEXT NOT NULL,
  "admissibility_rules" TEXT NOT NULL,
  "budget_constraints" TEXT NOT NULL,
  "retry_policy" TEXT,
  "manual_override_allowed" INTEGER NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS "policies_account" ON "routing_policies"("account_id");

CREATE TABLE IF NOT EXISTS "tasks" (
  "task_id" TEXT PRIMARY KEY,
  "account_id" TEXT NOT NULL REFERENCES "accounts"("account_id"),
  "description" TEXT NOT NULL,
  "requirements" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "created_at" TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS "tasks_account" ON "tasks"("account_id");
CREATE INDEX IF NOT EXISTS "tasks_status" ON "tasks"("status");

CREATE TABLE IF NOT EXISTS "routing_decisions" (
  "decision_id" TEXT PRIMARY KEY,
  "task_id" TEXT NOT NULL REFERENCES "tasks"("task_id"),
  "policy_id" TEXT NOT NULL REFERENCES "routing_policies"("policy_id"),
  "policy_version" INTEGER NOT NULL,
  "evaluated_routes" TEXT NOT NULL,
  "admissible_routes" TEXT NOT NULL,
  "selected_route_id" TEXT,
  "route_snapshot" TEXT,
  "rejection_reasons" TEXT NOT NULL,
  "estimated_cost" REAL,
  "decided_at" TEXT NOT NULL,
  "parent_decision_id" TEXT,
  "fallback_reason" TEXT,
  "ordering_strategy_unsupported" INTEGER
);

CREATE INDEX IF NOT EXISTS "decisions_task" ON "routing_decisions"("task_id");
CREATE INDEX IF NOT EXISTS "decisions_policy" ON "routing_decisions"("policy_id");
CREATE INDEX IF NOT EXISTS "decisions_decided_at" ON "routing_decisions"("decided_at");

CREATE TABLE IF NOT EXISTS "execution_attempts" (
  "attempt_id" TEXT PRIMARY KEY,
  "account_id" TEXT NOT NULL REFERENCES "accounts"("account_id"),
  "execution_id" TEXT NOT NULL,
  "task_id" TEXT NOT NULL REFERENCES "tasks"("task_id"),
  "decision_id" TEXT NOT NULL REFERENCES "routing_decisions"("decision_id"),
  "idempotency_key" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "started_at" TEXT,
  "completed_at" TEXT,
  "cancel_requested_at" TEXT,
  "cancelled_at" TEXT,
  "retry_count" INTEGER NOT NULL DEFAULT 0,
  "retry_policy" TEXT,
  "parent_attempt_id" TEXT,
  "verification_outcome" TEXT,
  "failure_code" TEXT,
  "created_at" TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "attempts_idempotency" ON "execution_attempts"("account_id", "idempotency_key");
CREATE INDEX IF NOT EXISTS "attempts_execution" ON "execution_attempts"("execution_id");
CREATE INDEX IF NOT EXISTS "attempts_task" ON "execution_attempts"("task_id");
CREATE INDEX IF NOT EXISTS "attempts_decision" ON "execution_attempts"("decision_id");
CREATE INDEX IF NOT EXISTS "attempts_status" ON "execution_attempts"("status");

CREATE TABLE IF NOT EXISTS "usage_records" (
  "usage_id" TEXT PRIMARY KEY,
  "account_id" TEXT NOT NULL REFERENCES "accounts"("account_id"),
  "attempt_id" TEXT NOT NULL UNIQUE REFERENCES "execution_attempts"("attempt_id"),
  "provider_usage_data" TEXT NOT NULL,
  "actual_cost" REAL NOT NULL,
  "cost_breakdown" TEXT NOT NULL,
  "input_tokens" INTEGER,
  "output_tokens" INTEGER,
  "reconciled_at" TEXT NOT NULL,
  "cost_variance" REAL
);

CREATE INDEX IF NOT EXISTS "usage_account" ON "usage_records"("account_id");
CREATE INDEX IF NOT EXISTS "usage_reconciled_at" ON "usage_records"("reconciled_at");

CREATE TABLE IF NOT EXISTS "audit_events" (
  "event_id" TEXT PRIMARY KEY,
  "account_id" TEXT,
  "event_type" TEXT NOT NULL,
  "actor" TEXT NOT NULL,
  "resource_type" TEXT,
  "resource_id" TEXT,
  "metadata" TEXT NOT NULL,
  "timestamp" TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS "audit_account" ON "audit_events"("account_id");
CREATE INDEX IF NOT EXISTS "audit_event_type" ON "audit_events"("event_type");
CREATE INDEX IF NOT EXISTS "audit_timestamp" ON "audit_events"("timestamp");
CREATE INDEX IF NOT EXISTS "audit_account_timestamp" ON "audit_events"("account_id", "timestamp");

CREATE TABLE IF NOT EXISTS "credential_references" (
  "credential_ref_id" TEXT PRIMARY KEY,
  "account_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "reference_key" TEXT NOT NULL,
  "auth_method" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "rotation_at" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS "credrefs_account" ON "credential_references"("account_id");
CREATE INDEX IF NOT EXISTS "credrefs_provider" ON "credential_references"("provider");
CREATE UNIQUE INDEX IF NOT EXISTS "credrefs_account_provider" ON "credential_references"("account_id", "provider");
