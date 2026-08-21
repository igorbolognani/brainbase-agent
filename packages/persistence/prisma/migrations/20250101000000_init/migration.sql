-- CreateTable
CREATE TABLE "Principal" (
    "principal_id" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "host" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Principal_pkey" PRIMARY KEY ("principal_id")
);

-- CreateTable
CREATE TABLE "Account" (
    "account_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("account_id")
);

-- CreateTable
CREATE TABLE "AccountMembership" (
    "membership_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "principal_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountMembership_pkey" PRIMARY KEY ("membership_id")
);

-- CreateTable
CREATE TABLE "ProviderConnection" (
    "connection_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "credential_reference" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderConnection_pkey" PRIMARY KEY ("connection_id")
);

-- CreateTable
CREATE TABLE "GatewayConnection" (
    "connection_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "gateway_url" TEXT NOT NULL,
    "gateway_type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "credential_reference" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GatewayConnection_pkey" PRIMARY KEY ("connection_id")
);

-- CreateTable
CREATE TABLE "ModelRoute" (
    "route_id" TEXT NOT NULL,
    "route_type" TEXT NOT NULL,
    "provider_connection_id" TEXT,
    "gateway_connection_id" TEXT,
    "source_id" TEXT NOT NULL,
    "source_provider" TEXT,
    "source_gateway" TEXT,
    "capabilities" JSONB NOT NULL,
    "pricing_input" DOUBLE PRECISION NOT NULL,
    "pricing_output" DOUBLE PRECISION NOT NULL,
    "pricing_currency" TEXT NOT NULL DEFAULT 'USD',
    "pricing_units" TEXT NOT NULL DEFAULT 'per_1k_tokens',
    "pricing_source" TEXT NOT NULL,
    "pricing_effective_at" TIMESTAMP(3) NOT NULL,
    "pricing_refreshed_at" TIMESTAMP(3) NOT NULL,
    "pricing_version" TEXT NOT NULL,
    "availability_status" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModelRoute_pkey" PRIMARY KEY ("route_id")
);

-- CreateTable
CREATE TABLE "RoutingPolicy" (
    "policy_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ordering_strategy" TEXT NOT NULL,
    "admissibility_rules" JSONB NOT NULL,
    "budget_constraints" JSONB NOT NULL,
    "retry_policy" JSONB,
    "manual_override_allowed" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoutingPolicy_pkey" PRIMARY KEY ("policy_id")
);

-- CreateTable
CREATE TABLE "Task" (
    "task_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "requirements" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "routingPolicyPolicy_id" TEXT,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("task_id")
);

-- CreateTable
CREATE TABLE "RoutingDecision" (
    "decision_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "policy_id" TEXT NOT NULL,
    "policy_version" INTEGER NOT NULL,
    "evaluated_routes" JSONB NOT NULL,
    "admissible_routes" JSONB NOT NULL,
    "selected_route_id" TEXT,
    "route_snapshot" JSONB,
    "rejection_reasons" JSONB NOT NULL,
    "estimated_cost" DOUBLE PRECISION,
    "decided_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "parent_decision_id" TEXT,
    "fallback_reason" TEXT,
    "ordering_strategy_unsupported" BOOLEAN,

    CONSTRAINT "RoutingDecision_pkey" PRIMARY KEY ("decision_id")
);

-- CreateTable
CREATE TABLE "Execution" (
    "execution_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "root_decision_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Execution_pkey" PRIMARY KEY ("execution_id")
);

-- CreateTable
CREATE TABLE "ExecutionAttempt" (
    "attempt_id" TEXT NOT NULL,
    "execution_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "decision_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "cancel_requested_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "retry_policy" JSONB,
    "parent_attempt_id" TEXT,
    "verification_outcome" TEXT,
    "failure_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExecutionAttempt_pkey" PRIMARY KEY ("attempt_id")
);

-- CreateTable
CREATE TABLE "UsageRecord" (
    "usage_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "attempt_id" TEXT NOT NULL,
    "provider_usage_data" JSONB NOT NULL,
    "actual_cost" DOUBLE PRECISION,
    "cost_breakdown" JSONB NOT NULL,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "reconciled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cost_variance" DOUBLE PRECISION,

    CONSTRAINT "UsageRecord_pkey" PRIMARY KEY ("usage_id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "event_id" TEXT NOT NULL,
    "account_id" TEXT,
    "event_type" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "resource_type" TEXT,
    "resource_id" TEXT,
    "metadata" JSONB NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("event_id")
);

-- CreateTable
CREATE TABLE "CredentialReference" (
    "credential_ref_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "reference_key" TEXT NOT NULL,
    "auth_method" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "rotation_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CredentialReference_pkey" PRIMARY KEY ("credential_ref_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Principal_issuer_subject_key" ON "Principal"("issuer", "subject");

-- CreateIndex
CREATE INDEX "Principal_issuer_idx" ON "Principal"("issuer");

-- CreateIndex
CREATE INDEX "Principal_subject_idx" ON "Principal"("subject");

-- CreateIndex
CREATE UNIQUE INDEX "AccountMembership_account_id_principal_id_key" ON "AccountMembership"("account_id", "principal_id");

-- CreateIndex
CREATE INDEX "AccountMembership_principal_id_idx" ON "AccountMembership"("principal_id");

-- CreateIndex
CREATE INDEX "AccountMembership_account_id_idx" ON "AccountMembership"("account_id");

-- CreateIndex
CREATE INDEX "ProviderConnection_account_id_idx" ON "ProviderConnection"("account_id");

-- CreateIndex
CREATE INDEX "ProviderConnection_provider_idx" ON "ProviderConnection"("provider");

-- CreateIndex
CREATE INDEX "ProviderConnection_status_idx" ON "ProviderConnection"("status");

-- CreateIndex
CREATE INDEX "GatewayConnection_account_id_idx" ON "GatewayConnection"("account_id");

-- CreateIndex
CREATE INDEX "GatewayConnection_gateway_url_idx" ON "GatewayConnection"("gateway_url");

-- CreateIndex
CREATE INDEX "GatewayConnection_status_idx" ON "GatewayConnection"("status");

-- CreateIndex
CREATE INDEX "ModelRoute_provider_connection_id_idx" ON "ModelRoute"("provider_connection_id");

-- CreateIndex
CREATE INDEX "ModelRoute_gateway_connection_id_idx" ON "ModelRoute"("gateway_connection_id");

-- CreateIndex
CREATE INDEX "ModelRoute_source_id_idx" ON "ModelRoute"("source_id");

-- CreateIndex
CREATE INDEX "ModelRoute_availability_status_idx" ON "ModelRoute"("availability_status");

-- CreateIndex
CREATE INDEX "RoutingPolicy_account_id_idx" ON "RoutingPolicy"("account_id");

-- CreateIndex
CREATE INDEX "Task_account_id_idx" ON "Task"("account_id");

-- CreateIndex
CREATE INDEX "Task_status_idx" ON "Task"("status");

-- CreateIndex
CREATE INDEX "RoutingDecision_task_id_idx" ON "RoutingDecision"("task_id");

-- CreateIndex
CREATE INDEX "RoutingDecision_policy_id_idx" ON "RoutingDecision"("policy_id");

-- CreateIndex
CREATE INDEX "RoutingDecision_decided_at_idx" ON "RoutingDecision"("decided_at");

-- CreateIndex
CREATE UNIQUE INDEX "Execution_account_id_idempotency_key_key" ON "Execution"("account_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "Execution_account_id_idx" ON "Execution"("account_id");

-- CreateIndex
CREATE INDEX "Execution_task_id_idx" ON "Execution"("task_id");

-- CreateIndex
CREATE INDEX "Execution_root_decision_id_idx" ON "Execution"("root_decision_id");

-- CreateIndex
CREATE INDEX "Execution_status_idx" ON "Execution"("status");

-- CreateIndex
CREATE INDEX "ExecutionAttempt_execution_id_idx" ON "ExecutionAttempt"("execution_id");

-- CreateIndex
CREATE INDEX "ExecutionAttempt_account_id_idx" ON "ExecutionAttempt"("account_id");

-- CreateIndex
CREATE INDEX "ExecutionAttempt_task_id_idx" ON "ExecutionAttempt"("task_id");

-- CreateIndex
CREATE INDEX "ExecutionAttempt_decision_id_idx" ON "ExecutionAttempt"("decision_id");

-- CreateIndex
CREATE INDEX "ExecutionAttempt_status_idx" ON "ExecutionAttempt"("status");

-- CreateIndex
CREATE UNIQUE INDEX "UsageRecord_attempt_id_key" ON "UsageRecord"("attempt_id");

-- CreateIndex
CREATE INDEX "UsageRecord_account_id_idx" ON "UsageRecord"("account_id");

-- CreateIndex
CREATE INDEX "UsageRecord_reconciled_at_idx" ON "UsageRecord"("reconciled_at");

-- CreateIndex
CREATE INDEX "AuditEvent_account_id_idx" ON "AuditEvent"("account_id");

-- CreateIndex
CREATE INDEX "AuditEvent_event_type_idx" ON "AuditEvent"("event_type");

-- CreateIndex
CREATE INDEX "AuditEvent_timestamp_idx" ON "AuditEvent"("timestamp");

-- CreateIndex
CREATE INDEX "AuditEvent_account_id_timestamp_idx" ON "AuditEvent"("account_id", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "CredentialReference_account_id_provider_key" ON "CredentialReference"("account_id", "provider");

-- CreateIndex
CREATE INDEX "CredentialReference_account_id_idx" ON "CredentialReference"("account_id");

-- CreateIndex
CREATE INDEX "CredentialReference_provider_idx" ON "CredentialReference"("provider");

-- AddForeignKey
ALTER TABLE "AccountMembership" ADD CONSTRAINT "AccountMembership_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "Account"("account_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountMembership" ADD CONSTRAINT "AccountMembership_principal_id_fkey" FOREIGN KEY ("principal_id") REFERENCES "Principal"("principal_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderConnection" ADD CONSTRAINT "ProviderConnection_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "Account"("account_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GatewayConnection" ADD CONSTRAINT "GatewayConnection_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "Account"("account_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelRoute" ADD CONSTRAINT "ModelRoute_provider_connection_id_fkey" FOREIGN KEY ("provider_connection_id") REFERENCES "ProviderConnection"("connection_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelRoute" ADD CONSTRAINT "ModelRoute_gateway_connection_id_fkey" FOREIGN KEY ("gateway_connection_id") REFERENCES "GatewayConnection"("connection_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutingPolicy" ADD CONSTRAINT "RoutingPolicy_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "Account"("account_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "Account"("account_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_routingPolicyPolicy_id_fkey" FOREIGN KEY ("routingPolicyPolicy_id") REFERENCES "RoutingPolicy"("policy_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutingDecision" ADD CONSTRAINT "RoutingDecision_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "Task"("task_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutingDecision" ADD CONSTRAINT "RoutingDecision_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "RoutingPolicy"("policy_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Execution" ADD CONSTRAINT "Execution_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "Account"("account_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Execution" ADD CONSTRAINT "Execution_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "Task"("task_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Execution" ADD CONSTRAINT "Execution_root_decision_id_fkey" FOREIGN KEY ("root_decision_id") REFERENCES "RoutingDecision"("decision_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionAttempt" ADD CONSTRAINT "ExecutionAttempt_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "Execution"("execution_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionAttempt" ADD CONSTRAINT "ExecutionAttempt_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "Account"("account_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionAttempt" ADD CONSTRAINT "ExecutionAttempt_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "Task"("task_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionAttempt" ADD CONSTRAINT "ExecutionAttempt_decision_id_fkey" FOREIGN KEY ("decision_id") REFERENCES "RoutingDecision"("decision_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageRecord" ADD CONSTRAINT "UsageRecord_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "Account"("account_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageRecord" ADD CONSTRAINT "UsageRecord_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "ExecutionAttempt"("attempt_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "Account"("account_id") ON DELETE SET NULL ON UPDATE CASCADE;
