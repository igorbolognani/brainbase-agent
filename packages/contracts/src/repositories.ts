/**
 * Repository interfaces for data access.
 * These are abstractions; implementations are injected.
 */

import type {
  Account,
  AccountMembership,
  AuditEvent,
  AvailabilityStatus,
  Connection,
  Execution,
  ExecutionAttempt,
  ModelMetadata,
  ModelOffering,
  ModelQualityEvidence,
  ModelRoute,
  OrchestrationGraph,
  OrchestrationNode,
  Principal,
  RoutingDecision,
  RoutingPolicy,
  Task,
  UsageRecord,
} from './types.js';

// ============================================================================
// Model Catalog
// ============================================================================

export interface ModelCatalog {
  listModels(): Promise<ModelMetadata[]>;
  getModel(model_id: string): Promise<ModelMetadata | null>;
  refreshMetadata(): Promise<void>;
  getMetadataVersion(): string;
}

// ============================================================================
// Identity / Tenant Repositories
// ============================================================================

export interface PrincipalRepository {
  getPrincipal(principal_id: string): Promise<Principal | null>;
  getPrincipalBySubject(issuer: string, subject: string): Promise<Principal | null>;
}

export interface AccountRepository {
  getAccount(account_id: string): Promise<Account | null>;
  createAccount(account: Omit<Account, 'created_at'>): Promise<Account>;
}

export interface MembershipRepository {
  getMembership(account_id: string, principal_id: string): Promise<AccountMembership | null>;
  listMembershipsForPrincipal(principal_id: string): Promise<AccountMembership[]>;
}

// ============================================================================
// Domain Repositories
// ============================================================================

export interface ConnectionRepository {
  listConnections(account_id: string): Promise<Connection[]>;
  getConnection(connection_id: string): Promise<Connection | null>;
  createConnection(connection: Omit<Connection, 'created_at' | 'updated_at'>): Promise<Connection>;
  updateConnectionStatus(connection_id: string, status: Connection['status']): Promise<void>;
  deleteConnection(connection_id: string): Promise<void>;
}

export interface RouteRepository {
  listRoutes(account_id: string): Promise<ModelRoute[]>;
  getRoute(route_id: string): Promise<ModelRoute | null>;
  getRoutesForConnection(connection_id: string): Promise<ModelRoute[]>;
  updateRouteAvailability(route_id: string, status: AvailabilityStatus): Promise<void>;
}

export interface PolicyRepository {
  getPolicy(policy_id: string): Promise<RoutingPolicy | null>;
  getDefaultPolicy(account_id: string): Promise<RoutingPolicy | null>;
  listPolicies(account_id: string): Promise<RoutingPolicy[]>;
  createPolicy(policy: Omit<RoutingPolicy, 'created_at' | 'updated_at'>): Promise<RoutingPolicy>;
  updatePolicy(policy: RoutingPolicy): Promise<RoutingPolicy>;
}

export interface TaskRepository {
  getTask(task_id: string): Promise<Task | null>;
  listTasks(account_id: string): Promise<Task[]>;
  createTask(task: Omit<Task, 'created_at'>): Promise<Task>;
  updateTaskStatus(
    task_id: string,
    status: Task['status'],
    expected_status?: Task['status']
  ): Promise<void>;
}

export interface DecisionRepository {
  getDecision(decision_id: string): Promise<RoutingDecision | null>;
  createDecision(decision: Omit<RoutingDecision, 'decided_at'>): Promise<RoutingDecision>;
  listDecisionsForTask(task_id: string): Promise<RoutingDecision[]>;
}

export interface ExecutionRepository {
  /** Durable root execution identity. Optional for legacy in-memory adapters. */
  getExecution?(execution_id: string): Promise<Execution | null>;
  getExecutionByIdempotencyKey?(
    account_id: string,
    idempotency_key: string
  ): Promise<Execution | null>;
  createExecution?(execution: Omit<Execution, 'created_at'>): Promise<Execution>;
  createExecutionWithRootAttempt?(
    execution: Omit<Execution, 'created_at'>,
    attempt: Omit<ExecutionAttempt, 'created_at'>
  ): Promise<{ execution: Execution; attempt: ExecutionAttempt }>;
  updateExecutionStatus?(
    execution_id: string,
    status: Execution['status'],
    expected_status?: Execution['status']
  ): Promise<void>;
  getAttempt(attempt_id: string): Promise<ExecutionAttempt | null>;
  getAttemptByIdempotencyKey(
    account_id: string,
    idempotency_key: string
  ): Promise<ExecutionAttempt | null>;
  createAttempt(attempt: Omit<ExecutionAttempt, 'created_at'>): Promise<ExecutionAttempt>;
  listAttemptsForTask(task_id: string): Promise<ExecutionAttempt[]>;
  updateAttemptStatus(
    attempt_id: string,
    status: ExecutionAttempt['status'],
    updates: Partial<ExecutionAttempt>,
    expected_status?: ExecutionAttempt['status']
  ): Promise<void>;
}

export interface UsageRepository {
  getUsage(usage_id: string): Promise<UsageRecord | null>;
  getUsageForAttempt(attempt_id: string): Promise<UsageRecord | null>;
  createUsage(usage: Omit<UsageRecord, 'reconciled_at'>): Promise<UsageRecord>;
  listUsageForAccount(account_id: string): Promise<UsageRecord[]>;
  getDailySpending(account_id: string): Promise<number>;
  getMonthlySpending(account_id: string): Promise<number>;
}

export interface AuditRepository {
  recordEvent(event: Omit<AuditEvent, 'timestamp'>): Promise<AuditEvent>;
  listEvents(
    account_id: string,
    filters?: {
      event_type?: string;
      start_time?: Date;
      end_time?: Date;
      limit?: number;
      offset?: number;
    }
  ): Promise<{ events: AuditEvent[]; total_count: number }>;
}

// ============================================================================
// Phase 4: Model Offering Catalog
// ============================================================================

export interface ModelOfferingRepository {
  getOffering(offering_id: string): Promise<ModelOffering | null>;
  listOfferings(filters?: {
    provider?: string;
    capability?: string;
    availability?: AvailabilityStatus;
  }): Promise<ModelOffering[]>;
  upsertOffering(
    offering: Omit<ModelOffering, 'effective_at' | 'refreshed_at'>
  ): Promise<ModelOffering>;
  updateHealth(offering_id: string, health_state: ModelOffering['health_state']): Promise<void>;
}

export interface ModelEvidenceRepository {
  getEvidence(evidence_id: string): Promise<ModelQualityEvidence | null>;
  listEvidenceForOffering(offering_id: string): Promise<ModelQualityEvidence[]>;
  listEvidenceForModel(provider: string, model_id: string): Promise<ModelQualityEvidence[]>;
  upsertEvidence(
    evidence: Omit<ModelQualityEvidence, 'ingested_at'>
  ): Promise<ModelQualityEvidence>;
}

// ============================================================================
// Phase 5: Orchestration Graph
// ============================================================================

export interface OrchestrationGraphRepository {
  getGraph(graph_id: string): Promise<OrchestrationGraph | null>;
  getGraphByExecution(execution_id: string): Promise<OrchestrationGraph | null>;
  createGraph(
    graph: Omit<OrchestrationGraph, 'created_at' | 'updated_at'>
  ): Promise<OrchestrationGraph>;
  updateGraphStatus(graph_id: string, status: OrchestrationGraph['status']): Promise<void>;
  listNodes(graph_id: string): Promise<OrchestrationNode[]>;
  createNode(
    node: Omit<OrchestrationNode, 'created_at' | 'updated_at'>
  ): Promise<OrchestrationNode>;
  updateNodeStatus(node_id: string, status: OrchestrationNode['status']): Promise<void>;
  countNodes(graph_id: string): Promise<number>;
}
