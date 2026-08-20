import type {
  AuditRepository,
  AuthorizedExecutionContext,
  DecisionRepository,
  ExecutionAttempt,
  ExecutionRepository,
  PolicyRepository,
  RoutingDecision,
  Task,
  TaskRepository,
  UsageRecord,
  UsageRepository,
  VerificationOutcome,
} from '@gptrouter/contracts';
import { BudgetEnforcer } from './budget-enforcer.js';
import { generateId } from './utils.js';

export interface ExecutionRequest {
  task_id: string;
  decision_id: string;
  idempotency_key: string;
}

export interface ExecutionInput {
  task: Task;
  decision: RoutingDecision;
  attempt: ExecutionAttempt;
}

export interface ExecutionOutput {
  provider_usage_data: Record<string, unknown>;
  actual_cost: number;
  cost_breakdown: Record<string, unknown>;
  tokens_used: { input: number; output: number } | null;
}

export interface ExecutionExecutor {
  execute(input: ExecutionInput): Promise<ExecutionOutput>;
}

export interface VerificationResult {
  outcome: VerificationOutcome;
  failure_code?: string;
}

export interface ExecutionVerifier {
  verify(output: ExecutionOutput, input: ExecutionInput): Promise<VerificationResult>;
}

export type ExecutionRequestErrorCode =
  | 'access_denied'
  | 'task_not_found'
  | 'decision_not_found'
  | 'decision_task_mismatch'
  | 'route_snapshot_missing'
  | 'invalid_task_state'
  | 'policy_unavailable'
  | 'budget_denied'
  | 'idempotency_conflict'
  | 'usage_reconciliation_failed';

/** Errors in the consequential request surface have stable, safe messages. */
export class ExecutionRequestError extends Error {
  constructor(
    readonly code: ExecutionRequestErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'ExecutionRequestError';
  }
}

export class IdempotencyConflictError extends ExecutionRequestError {
  constructor() {
    super('idempotency_conflict', 'Idempotency key was already used for another execution');
    this.name = 'IdempotencyConflictError';
  }
}

export interface ExecutionProjection {
  task_id: string;
  decision_id: string;
  attempt_id: string;
  status: ExecutionAttempt['status'];
  task_status: Task['status'];
  execution_status: ExecutionAttempt['status'];
  verification_outcome: VerificationOutcome | null;
  failure_code: string | null;
  estimated_cost: number | null;
  actual_cost: number;
  usage_id: string | null;
  replayed: boolean;
  data_mode: 'synthetic_execution';
}

export interface ExecutionCoordinatorRepositories {
  tasks: Pick<TaskRepository, 'getTask' | 'updateTaskStatus'>;
  decisions: Pick<DecisionRepository, 'getDecision'>;
  policies: Pick<PolicyRepository, 'getPolicy'>;
  executions: Pick<
    ExecutionRepository,
    'getAttempt' | 'getAttemptByIdempotencyKey' | 'createAttempt' | 'updateAttemptStatus'
  >;
  usage: Pick<UsageRepository, 'getUsageForAttempt' | 'createUsage'>;
  audit: Pick<AuditRepository, 'recordEvent'>;
}

export interface ExecutionCoordinatorOptions {
  repositories: ExecutionCoordinatorRepositories;
  budgetEnforcer: BudgetEnforcer;
  executor: ExecutionExecutor;
  verifier: ExecutionVerifier;
  clock?: () => Date;
}

export interface SyntheticExecutorOptions {
  fail?: boolean;
}

/**
 * Deterministic, provider-neutral execution used by the V0.1 no-spend slice.
 * It never reads credentials, performs I/O, or includes task input in output.
 */
export class SyntheticExecutor implements ExecutionExecutor {
  private invocations = 0;

  constructor(private readonly options: SyntheticExecutorOptions = {}) {}

  get invocationCount(): number {
    return this.invocations;
  }

  async execute(_input: ExecutionInput): Promise<ExecutionOutput> {
    this.invocations += 1;
    if (this.options.fail) throw new Error('synthetic_executor_failure');

    return {
      provider_usage_data: {
        execution_mode: 'synthetic',
        result: 'deterministic_success',
      },
      actual_cost: 0,
      cost_breakdown: { execution_mode: 'synthetic', actual_cost: 0 },
      tokens_used: { input: 0, output: 0 },
    };
  }
}

/** Deterministic verifier seam with the Phase 1B outcome already modelled. */
export class DeterministicVerifier implements ExecutionVerifier {
  constructor(
    private readonly outcome: VerificationOutcome = 'accepted',
    private readonly failure_code?: string
  ) {}

  async verify(_output: ExecutionOutput, _input: ExecutionInput): Promise<VerificationResult> {
    return { outcome: this.outcome, failure_code: this.failure_code };
  }
}

function isIdempotencyConflict(error: unknown): boolean {
  return (
    error instanceof IdempotencyConflictError ||
    (typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === 'idempotency_conflict')
  );
}

function safeFailureCode(code: string | undefined, fallback: string): string {
  return code && /^[a-z0-9_:-]+$/i.test(code) ? code : fallback;
}

export class ExecutionCoordinator {
  private readonly inFlight = new Map<string, Promise<ExecutionProjection>>();
  private readonly clock: () => Date;

  constructor(private readonly options: ExecutionCoordinatorOptions) {
    this.clock = options.clock ?? (() => new Date());
  }

  async runTask(
    context: AuthorizedExecutionContext,
    request: ExecutionRequest
  ): Promise<ExecutionProjection> {
    const accountId = context.account.account_id;
    const existing = await this.options.repositories.executions.getAttemptByIdempotencyKey(
      accountId,
      request.idempotency_key
    );
    if (existing) return this.replayOrReject(existing, context, request);

    const operationKey = `${accountId}\u0000${request.idempotency_key}`;
    const running = this.inFlight.get(operationKey);
    if (running) return running;

    const operation = this.executeNew(context, request);
    this.inFlight.set(operationKey, operation);
    try {
      return await operation;
    } finally {
      this.inFlight.delete(operationKey);
    }
  }

  private async replayOrReject(
    attempt: ExecutionAttempt,
    context: AuthorizedExecutionContext,
    request: ExecutionRequest
  ): Promise<ExecutionProjection> {
    if (attempt.task_id !== request.task_id || attempt.decision_id !== request.decision_id) {
      throw new IdempotencyConflictError();
    }
    if (attempt.account_id !== context.account.account_id) {
      throw new ExecutionRequestError('access_denied', 'Access denied');
    }
    return this.projectAttempt(attempt, request, true);
  }

  private async executeNew(
    context: AuthorizedExecutionContext,
    request: ExecutionRequest
  ): Promise<ExecutionProjection> {
    const repositories = this.options.repositories;
    const task = await repositories.tasks.getTask(request.task_id);
    if (!task) throw new ExecutionRequestError('task_not_found', 'Task was not found');
    if (task.account_id !== context.account.account_id) {
      throw new ExecutionRequestError('access_denied', 'Access denied');
    }

    const decision = await repositories.decisions.getDecision(request.decision_id);
    if (!decision) throw new ExecutionRequestError('decision_not_found', 'Decision was not found');
    if (decision.task_id !== task.task_id) {
      throw new ExecutionRequestError(
        'decision_task_mismatch',
        'Decision does not belong to the requested task'
      );
    }
    if (
      !decision.route_snapshot ||
      !decision.selected_route_id ||
      decision.route_snapshot.route_id !== decision.selected_route_id
    ) {
      throw new ExecutionRequestError(
        'route_snapshot_missing',
        'The routing decision has no executable route snapshot'
      );
    }

    if (task.status === 'planning') {
      await repositories.tasks.updateTaskStatus(task.task_id, 'approved');
      await this.recordAudit(context, 'task.execution.approved', task.task_id, {
        decision_id: decision.decision_id,
      });
    } else if (task.status !== 'approved') {
      throw new ExecutionRequestError(
        'invalid_task_state',
        `Task cannot be executed from status ${task.status}`
      );
    }

    const policy = await repositories.policies.getPolicy(decision.policy_id);
    if (!policy || policy.account_id !== context.account.account_id) {
      throw new ExecutionRequestError('policy_unavailable', 'Execution policy is unavailable');
    }
    if (decision.estimated_cost === null) {
      throw new ExecutionRequestError('budget_denied', 'Execution estimate is unavailable');
    }

    const budget = await this.options.budgetEnforcer.checkBudget(
      context.account.account_id,
      decision.estimated_cost,
      policy
    );
    if (!budget.allowed) {
      throw new ExecutionRequestError('budget_denied', 'Execution budget denied');
    }

    let attempt: ExecutionAttempt;
    try {
      attempt = await repositories.executions.createAttempt({
        attempt_id: `attempt_${generateId()}`,
        account_id: context.account.account_id,
        task_id: task.task_id,
        decision_id: decision.decision_id,
        idempotency_key: request.idempotency_key,
        status: 'pending',
        started_at: null,
        completed_at: null,
        cancel_requested_at: null,
        cancelled_at: null,
        retry_count: 0,
        retry_policy: null,
        verification_outcome: null,
        failure_code: null,
      });
    } catch (error) {
      if (!isIdempotencyConflict(error)) throw error;
      const concurrent = await repositories.executions.getAttemptByIdempotencyKey(
        context.account.account_id,
        request.idempotency_key
      );
      if (!concurrent) throw new IdempotencyConflictError();
      return this.replayOrReject(concurrent, context, request);
    }

    const startedAt = this.now();
    await repositories.executions.updateAttemptStatus(attempt.attempt_id, 'running', {
      started_at: startedAt,
    });
    await repositories.tasks.updateTaskStatus(task.task_id, 'executing');
    await this.recordAudit(context, 'task.execution.started', task.task_id, {
      attempt_id: attempt.attempt_id,
      decision_id: decision.decision_id,
    });

    const runningAttempt: ExecutionAttempt = {
      ...attempt,
      status: 'running',
      started_at: startedAt,
    };
    let output: ExecutionOutput | null = null;
    let verification: VerificationResult = {
      outcome: 'terminal_failure',
      failure_code: 'executor_failure',
    };

    try {
      output = await this.options.executor.execute({
        task,
        decision,
        attempt: runningAttempt,
      });
      try {
        verification = await this.options.verifier.verify(output, {
          task,
          decision,
          attempt: runningAttempt,
        });
      } catch {
        verification = { outcome: 'terminal_failure', failure_code: 'verifier_failure' };
      }
    } catch {
      verification = { outcome: 'terminal_failure', failure_code: 'executor_failure' };
    }

    let usage: UsageRecord | null = null;
    if (output) {
      try {
        usage = await this.reconcileUsage(context, runningAttempt, decision.estimated_cost, output);
      } catch {
        return this.finishFailure(
          context,
          task,
          decision,
          runningAttempt,
          'usage_reconciliation_failed',
          null
        );
      }
    }

    if (verification.outcome === 'accepted') {
      const completedAt = this.now();
      await repositories.executions.updateAttemptStatus(attempt.attempt_id, 'completed', {
        completed_at: completedAt,
        verification_outcome: 'accepted',
        failure_code: null,
      });
      await repositories.tasks.updateTaskStatus(task.task_id, 'completed');
      await this.recordAudit(context, 'task.execution.completed', task.task_id, {
        attempt_id: attempt.attempt_id,
        decision_id: decision.decision_id,
      });
      return {
        task_id: task.task_id,
        decision_id: decision.decision_id,
        attempt_id: attempt.attempt_id,
        status: 'completed',
        task_status: 'completed',
        execution_status: 'completed',
        verification_outcome: 'accepted',
        failure_code: null,
        estimated_cost: decision.estimated_cost,
        actual_cost: usage?.actual_cost ?? 0,
        usage_id: usage?.usage_id ?? null,
        replayed: false,
        data_mode: 'synthetic_execution',
      };
    }

    return this.finishFailure(
      context,
      task,
      decision,
      runningAttempt,
      safeFailureCode(verification.failure_code, 'terminal_verification_failure'),
      usage
    );
  }

  private async reconcileUsage(
    context: AuthorizedExecutionContext,
    attempt: ExecutionAttempt,
    estimatedCost: number,
    output: ExecutionOutput
  ): Promise<UsageRecord> {
    const existing = await this.options.repositories.usage.getUsageForAttempt(attempt.attempt_id);
    if (existing) return existing;

    const usage = await this.options.repositories.usage.createUsage({
      usage_id: `usage_${generateId()}`,
      account_id: context.account.account_id,
      attempt_id: attempt.attempt_id,
      provider_usage_data: output.provider_usage_data,
      actual_cost: output.actual_cost,
      cost_breakdown: output.cost_breakdown,
      tokens_used: output.tokens_used,
      cost_variance: output.actual_cost - estimatedCost,
    });
    await this.recordAudit(context, 'usage.reconciled', attempt.task_id, {
      attempt_id: attempt.attempt_id,
      usage_id: usage.usage_id,
      actual_cost: usage.actual_cost,
    });
    return usage;
  }

  private async finishFailure(
    context: AuthorizedExecutionContext,
    task: Task,
    decision: RoutingDecision,
    attempt: ExecutionAttempt,
    failureCode: string,
    usage: UsageRecord | null
  ): Promise<ExecutionProjection> {
    const completedAt = this.now();
    await this.options.repositories.executions.updateAttemptStatus(attempt.attempt_id, 'failed', {
      completed_at: completedAt,
      verification_outcome:
        failureCode === 'retryable_failure' ? 'retryable_failure' : 'terminal_failure',
      failure_code: failureCode,
    });
    await this.options.repositories.tasks.updateTaskStatus(task.task_id, 'failed');
    await this.recordAudit(context, 'task.execution.failed', task.task_id, {
      attempt_id: attempt.attempt_id,
      decision_id: decision.decision_id,
      failure_code: failureCode,
    });
    return {
      task_id: task.task_id,
      decision_id: decision.decision_id,
      attempt_id: attempt.attempt_id,
      status: 'failed',
      task_status: 'failed',
      execution_status: 'failed',
      verification_outcome:
        failureCode === 'retryable_failure' ? 'retryable_failure' : 'terminal_failure',
      failure_code: failureCode,
      estimated_cost: decision.estimated_cost,
      actual_cost: usage?.actual_cost ?? 0,
      usage_id: usage?.usage_id ?? null,
      replayed: false,
      data_mode: 'synthetic_execution',
    };
  }

  private async projectAttempt(
    attempt: ExecutionAttempt,
    request: ExecutionRequest,
    replayed: boolean
  ): Promise<ExecutionProjection> {
    const task = await this.options.repositories.tasks.getTask(request.task_id);
    const decision = await this.options.repositories.decisions.getDecision(request.decision_id);
    if (!task || !decision || decision.task_id !== task.task_id) {
      throw new ExecutionRequestError('access_denied', 'Access denied');
    }
    const usage = await this.options.repositories.usage.getUsageForAttempt(attempt.attempt_id);
    return {
      task_id: task.task_id,
      decision_id: decision.decision_id,
      attempt_id: attempt.attempt_id,
      status: attempt.status,
      task_status: task.status,
      execution_status: attempt.status,
      verification_outcome: attempt.verification_outcome,
      failure_code: attempt.failure_code,
      estimated_cost: decision.estimated_cost,
      actual_cost: usage?.actual_cost ?? 0,
      usage_id: usage?.usage_id ?? null,
      replayed,
      data_mode: 'synthetic_execution',
    };
  }

  private now(): Date {
    return new Date(this.clock().getTime());
  }

  private async recordAudit(
    context: AuthorizedExecutionContext,
    eventType: string,
    taskId: string,
    metadata: Record<string, unknown>
  ): Promise<void> {
    try {
      await this.options.repositories.audit.recordEvent({
        event_id: `event_${generateId()}`,
        account_id: context.account.account_id,
        event_type: eventType,
        actor: `principal:${context.principal.principal_id}`,
        resource_type: 'task',
        resource_id: taskId,
        metadata,
      });
    } catch {
      // Execution state is authoritative; an audit outage must not fabricate a
      // failed provider result or cause a consequential operation to dispatch twice.
    }
  }
}
