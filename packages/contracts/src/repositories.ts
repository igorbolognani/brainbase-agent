/**
 * Repository interfaces for data access.
 * These are abstractions; implementations are injected.
 */

import type {
  Account,
  AccountMembership,
  Principal,
  Connection,
  ModelRoute,
  RoutingPolicy,
  Task,
  RoutingDecision,
  ExecutionAttempt,
  UsageRecord,
  AuditEvent,
  ModelMetadata,
  AvailabilityStatus,
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
  createTask(task: Omit<Task, 'created_at'>): Promise<Task>;
  updateTaskStatus(task_id: string, status: Task['status']): Promise<void>;
}

export interface DecisionRepository {
  getDecision(decision_id: string): Promise<RoutingDecision | null>;
  createDecision(decision: Omit<RoutingDecision, 'decided_at'>): Promise<RoutingDecision>;
  listDecisionsForTask(task_id: string): Promise<RoutingDecision[]>;
}

export interface ExecutionRepository {
  getAttempt(attempt_id: string): Promise<ExecutionAttempt | null>;
  getAttemptByIdempotencyKey(
    account_id: string,
    idempotency_key: string
  ): Promise<ExecutionAttempt | null>;
  createAttempt(attempt: Omit<ExecutionAttempt, 'created_at'>): Promise<ExecutionAttempt>;
  updateAttemptStatus(
    attempt_id: string,
    status: ExecutionAttempt['status'],
    updates: Partial<ExecutionAttempt>
  ): Promise<void>;
}

export interface UsageRepository {
  getUsage(usage_id: string): Promise<UsageRecord | null>;
  getUsageForAttempt(attempt_id: string): Promise<UsageRecord | null>;
  createUsage(usage: Omit<UsageRecord, 'reconciled_at'>): Promise<UsageRecord>;
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
