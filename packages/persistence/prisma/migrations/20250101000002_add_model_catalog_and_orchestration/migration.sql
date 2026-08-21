-- CreateTable
CREATE TABLE "ModelOffering" (
    "offering_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model_id" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "capabilities" JSONB NOT NULL,
    "context_window" INTEGER,
    "max_output_tokens" INTEGER,
    "supports_tools" BOOLEAN NOT NULL DEFAULT false,
    "supports_vision" BOOLEAN NOT NULL DEFAULT false,
    "supports_audio" BOOLEAN NOT NULL DEFAULT false,
    "supports_structured_output" BOOLEAN NOT NULL DEFAULT false,
    "supports_reasoning" BOOLEAN NOT NULL DEFAULT false,
    "pricing_input" DOUBLE PRECISION NOT NULL,
    "pricing_output" DOUBLE PRECISION NOT NULL,
    "pricing_currency" TEXT NOT NULL DEFAULT 'USD',
    "pricing_units" TEXT NOT NULL DEFAULT 'per_1k_tokens',
    "pricing_source" TEXT NOT NULL,
    "pricing_effective_at" TIMESTAMP(3) NOT NULL,
    "pricing_refreshed_at" TIMESTAMP(3) NOT NULL,
    "pricing_version" TEXT NOT NULL,
    "availability_status" TEXT NOT NULL DEFAULT 'available',
    "health_state" TEXT NOT NULL DEFAULT 'healthy',
    "effective_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "refreshed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" TEXT NOT NULL,

    CONSTRAINT "ModelOffering_pkey" PRIMARY KEY ("offering_id")
);

-- CreateTable
CREATE TABLE "ModelQualityEvidence" (
    "evidence_id" TEXT NOT NULL,
    "offering_id" TEXT NOT NULL,
    "evidence_type" TEXT NOT NULL,
    "benchmark" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "task_family" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "score_scale" TEXT NOT NULL,
    "higher_is_better" BOOLEAN NOT NULL DEFAULT true,
    "sample_size" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "source_reference" TEXT NOT NULL,
    "measured_at" TIMESTAMP(3) NOT NULL,
    "ingested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "ModelQualityEvidence_pkey" PRIMARY KEY ("evidence_id")
);

-- CreateTable
CREATE TABLE "OrchestrationGraph" (
    "graph_id" TEXT NOT NULL,
    "execution_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "max_nodes" INTEGER NOT NULL DEFAULT 10,
    "max_parallel" INTEGER NOT NULL DEFAULT 4,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrchestrationGraph_pkey" PRIMARY KEY ("graph_id")
);

-- CreateTable
CREATE TABLE "OrchestrationNode" (
    "node_id" TEXT NOT NULL,
    "graph_id" TEXT NOT NULL,
    "parent_node_id" TEXT,
    "role" TEXT NOT NULL,
    "execution_id" TEXT,
    "decision_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrchestrationNode_pkey" PRIMARY KEY ("node_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ModelOffering_provider_model_id_key" ON "ModelOffering"("provider", "model_id");

-- CreateIndex
CREATE INDEX "ModelOffering_provider_idx" ON "ModelOffering"("provider");

-- CreateIndex
CREATE INDEX "ModelOffering_availability_status_idx" ON "ModelOffering"("availability_status");

-- CreateIndex
CREATE INDEX "ModelOffering_health_state_idx" ON "ModelOffering"("health_state");

-- CreateIndex
CREATE INDEX "ModelQualityEvidence_offering_id_idx" ON "ModelQualityEvidence"("offering_id");

-- CreateIndex
CREATE INDEX "ModelQualityEvidence_benchmark_idx" ON "ModelQualityEvidence"("benchmark");

-- CreateIndex
CREATE INDEX "ModelQualityEvidence_domain_idx" ON "ModelQualityEvidence"("domain");

-- CreateIndex
CREATE INDEX "ModelQualityEvidence_task_family_idx" ON "ModelQualityEvidence"("task_family");

-- CreateIndex
CREATE UNIQUE INDEX "OrchestrationGraph_execution_id_key" ON "OrchestrationGraph"("execution_id");

-- CreateIndex
CREATE INDEX "OrchestrationGraph_account_id_idx" ON "OrchestrationGraph"("account_id");

-- CreateIndex
CREATE INDEX "OrchestrationGraph_task_id_idx" ON "OrchestrationGraph"("task_id");

-- CreateIndex
CREATE INDEX "OrchestrationNode_graph_id_idx" ON "OrchestrationNode"("graph_id");

-- CreateIndex
CREATE INDEX "OrchestrationNode_execution_id_idx" ON "OrchestrationNode"("execution_id");

-- CreateIndex
CREATE INDEX "OrchestrationNode_status_idx" ON "OrchestrationNode"("status");

-- AddForeignKey
ALTER TABLE "ModelQualityEvidence" ADD CONSTRAINT "ModelQualityEvidence_offering_id_fkey" FOREIGN KEY ("offering_id") REFERENCES "ModelOffering"("offering_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrchestrationGraph" ADD CONSTRAINT "OrchestrationGraph_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "Account"("account_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrchestrationNode" ADD CONSTRAINT "OrchestrationNode_graph_id_fkey" FOREIGN KEY ("graph_id") REFERENCES "OrchestrationGraph"("graph_id") ON DELETE RESTRICT ON UPDATE CASCADE;
