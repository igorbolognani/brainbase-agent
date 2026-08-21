import type {
  AuditRepository,
  AuthorizedExecutionContext,
  DecisionRepository,
  ExecutionAttempt,
  ExecutionRepository,
  PolicyRepository,
  RetryPolicy,
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
  actual_cost: number | null;
  cost_breakdown: Record<string, unknown>;
  tokens_used: { input: number; output: number } | null;
}

export interface ExecutionCancellationInput {
  task: Task;
  decision: RoutingDecision;
  attempt: ExecutionAttempt;
}

export type ExecutionCancellationResult = 'cancelled' | 'not_supported';

export interface ExecutionExecutor {
  execute(input: ExecutionInput): Promise<ExecutionOutput>;
  cancel?(input: ExecutionCancellationInput): Promise<ExecutionCancellationResult>;
}

export class ExecutionCancelledError extends Error {
  constructor() {
    super('synthetic_execution_cancelled');
    this.name = 'ExecutionCancelledError';
  }
}

export interface VerificationResult {
  outcome: VerificationOutcome;
  failure_code?: string;
}

export interface ExecutionVerifier {
  verify(output: ExecutionOutput, input: ExecutionInput): Promise<VerificationResult>;
}

export interface FallbackPlanRequest {
  task: Task;
  original_decision: RoutingDecision;
  excluded_route_ids: string[];
}

export interface FallbackPlanner {
  planFallback(request: FallbackPlanRequest): Promise<RoutingDecision | null>;
}

export interface RetryScheduler {
  schedule(delay_ms: number): Promise<void>;
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
  | 'usage_reconciliation_failed'
  | 'fallback_denied';

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
  root_decision_id: string;
  execution_id: string;
  root_attempt_id: string;
  attempt_id: string;
  attempt_ids: string[];
  decision_ids: string[];
  retry_count: number;
  fallback_count: number;
  status: ExecutionAttempt['status'];
  task_status: Task['status'];
  execution_status: ExecutionAttempt['status'];
  verification_outcome: VerificationOutcome | null;
  failure_code: string | null;
  estimated_cost: number | null;
  estimated_total_cost: number;
  actual_cost: number;
  usage_id: string | null;
  replayed: boolean;
  data_mode: 'synthetic_execution';
}

export interface ExecutionCoordinatorRepositories {
  tasks: Pick<TaskRepository, 'getTask' | 'updateTaskStatus'>;
  decisions: Pick<DecisionRepository, 'getDecision' | 'createDecision'>;
  policies: Pick<PolicyRepository, 'getPolicy'>;
  executions: Pick<
    ExecutionRepository,
    | 'getAttempt'
    | 'getAttemptByIdempotencyKey'
    | 'createAttempt'
    | 'listAttemptsForTask'
    | 'updateAttemptStatus'
  >;
  usage: Pick<UsageRepository, 'getUsageForAttempt' | 'createUsage'>;
  audit: Pick<AuditRepository, 'recordEvent'>;
}

export interface ExecutionCoordinatorOptions {
  repositories: ExecutionCoordinatorRepositories;
  budgetEnforcer: BudgetEnforcer;
  executor: ExecutionExecutor;
  verifier: ExecutionVerifier;
  fallbackPlanner?: FallbackPlanner;
  scheduler?: RetryScheduler;
  clock?: () => Date;
  onAuditFailure?: () => void;
  beforeDispatch?: (attempt: ExecutionAttempt) => Promise<void>;
}

export interface SyntheticExecutorOptions {
  fail?: boolean;
  hold?: boolean;
  cancellation_supported?: boolean;
}

const syntheticOutput = (): ExecutionOutput => ({
  provider_usage_data: {
    execution_mode: 'synthetic',
    result: 'deterministic_success',
  },
  actual_cost: 0,
  cost_breakdown: { execution_mode: 'synthetic', actual_cost: 0 },
  tokens_used: { input: 0, output: 0 },
});

/**
 * Deterministic, provider-neutral execution used by the V0.1 no-spend slice.
 * It never reads credentials, performs I/O, or includes task input in output.
 */
export class SyntheticExecutor implements ExecutionExecutor {
  private invocations = 0;
  private readonly pending = new Map<
    string,
    { resolve: (output: ExecutionOutput) => void; reject: (error: Error) => void }
  >();
  private readonly invocationWaiters: Array<(attempt_id: string) => void> = [];

  constructor(private readonly options: SyntheticExecutorOptions = {}) {}

  get invocationCount(): number {
    return this.invocations;
  }

  async execute(input: ExecutionInput): Promise<ExecutionOutput> {
    this.invocations += 1;
    if (this.options.fail) throw new Error('synthetic_executor_failure');
    if (!this.options.hold) return syntheticOutput();

    const attemptId = input.attempt.attempt_id;
    return await new Promise<ExecutionOutput>((resolve, reject) => {
      this.pending.set(attemptId, { resolve, reject });
      const waiter = this.invocationWaiters.shift();
      waiter?.(attemptId);
    });
  }

  async waitForInvocation(): Promise<string> {
    const current = this.pending.keys().next().value;
    if (current) return current;
    return await new Promise<string>((resolve) => this.invocationWaiters.push(resolve));
  }

  release(attempt_id: string): void {
    const pending = this.pending.get(attempt_id);
    if (!pending) return;
    this.pending.delete(attempt_id);
    pending.resolve(syntheticOutput());
  }

  async cancel(input: ExecutionCancellationInput): Promise<ExecutionCancellationResult> {
    if (!this.options.cancellation_supported || !this.pending.has(input.attempt.attempt_id)) {
      return 'not_supported';
    }
    const pending = this.pending.get(input.attempt.attempt_id);
    this.pending.delete(input.attempt.attempt_id);
    pending?.reject(new ExecutionCancelledError());
    return 'cancelled';
  }
}

/** Deterministic verifier seam with the retry outcome already modelled. */
export class DeterministicVerifier implements ExecutionVerifier {
  constructor(
    private readonly outcome: VerificationOutcome = 'accepted',
    private readonly failure_code?: string
  ) {}

  async verify(_output: ExecutionOutput, _input: ExecutionInput): Promise<VerificationResult> {
    return { outcome: this.outcome, failure_code: this.failure_code };
  }
}

const immediateScheduler: RetryScheduler = {
  async schedule(_delay_ms) {
    // Backoff is represented and audited, but tests never wait on wall-clock time.
  },
};

interface NormalizedRetryPolicy {
  max_retries: number;
  backoff_multiplier: number;
  initial_delay_ms: number;
  retryable_failure_codes: string[];
  fallback_enabled: boolean;
  max_fallbacks: number;
  max_total_estimated_cost: number | null;
}

interface AttemptResult {
  outcome: 'accepted' | 'retryable_failure' | 'terminal_failure' | 'cancelled';
  failure_code: string | null;
}

function normalizeRetryPolicy(policy: RetryPolicy | null | undefined): NormalizedRetryPolicy {
  const maxRetries = Number.isInteger(policy?.max_retries)
    ? Math.max(0, policy?.max_retries ?? 0)
    : 0;
  const backoffMultiplier = Number.isFinite(policy?.backoff_multiplier)
    ? Math.max(1, policy?.backoff_multiplier ?? 1)
    : 1;
  const initialDelay = Number.isFinite(policy?.initial_delay_ms)
    ? Math.max(0, policy?.initial_delay_ms ?? 0)
    : 0;
  const maxFallbacks = Number.isInteger(policy?.max_fallbacks)
    ? Math.max(0, policy?.max_fallbacks ?? 0)
    : 0;
  const maxTotal =
    policy?.max_total_estimated_cost === undefined || policy.max_total_estimated_cost === null
      ? null
      : Math.max(0, policy.max_total_estimated_cost);

  return {
    max_retries: maxRetries,
    backoff_multiplier: backoffMultiplier,
    initial_delay_ms: initialDelay,
    retryable_failure_codes: [...(policy?.retryable_failure_codes ?? ['retryable_failure'])],
    fallback_enabled: policy?.fallback_enabled === true,
    max_fallbacks: maxFallbacks,
    max_total_estimated_cost: maxTotal,
  };
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

function isRetryable(verification: VerificationResult, policy: NormalizedRetryPolicy): boolean {
  if (verification.outcome !== 'retryable_failure') return false;
  if (policy.retryable_failure_codes.length === 0) return true;
  return policy.retryable_failure_codes.includes(verification.failure_code ?? 'retryable_failure');
}

export class ExecutionCoordinator {
  private readonly inFlight = new Map<string, Promise<ExecutionProjection>>();
  private readonly activeAttempts = new Map<
    string,
    {
      context: AuthorizedExecutionContext;
      task: Task;
      decision: RoutingDecision;
      attempt: ExecutionAttempt;
    }
  >();
  private readonly clock: () => Date;
  private readonly scheduler: RetryScheduler;

  constructor(private readonly options: ExecutionCoordinatorOptions) {
    this.clock = options.clock ?? (() => new Date());
    this.scheduler = options.scheduler ?? immediateScheduler;
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

  async cancelExecution(
    context: AuthorizedExecutionContext,
    attempt_id: string
  ): Promise<ExecutionProjection> {
    const attempt = await this.options.repositories.executions.getAttempt(attempt_id);
    if (!attempt) throw new ExecutionRequestError('access_denied', 'Access denied');
    const task = await this.options.repositories.tasks.getTask(attempt.task_id);
    if (
      !task ||
      task.account_id !== context.account.account_id ||
      attempt.account_id !== context.account.account_id
    ) {
      throw new ExecutionRequestError('access_denied', 'Access denied');
    }
    const decision = await this.options.repositories.decisions.getDecision(attempt.decision_id);
    if (!decision || decision.task_id !== task.task_id) {
      throw new ExecutionRequestError('access_denied', 'Access denied');
    }

    if (attempt.status === 'pending') {
      await this.options.repositories.executions.updateAttemptStatus(
        attempt.attempt_id,
        'cancelled',
        { cancelled_at: this.now() },
        'pending'
      );
      await this.recordAudit(context, 'task.execution.cancelled', task.task_id, {
        attempt_id: attempt.attempt_id,
        decision_id: decision.decision_id,
      });
      return this.projectExecution(attempt, context, false);
    }

    if (attempt.status === 'running') {
      await this.options.repositories.executions.updateAttemptStatus(
        attempt.attempt_id,
        'cancel_requested',
        { cancel_requested_at: this.now() },
        'running'
      );
      await this.recordAudit(context, 'task.execution.cancel_requested', task.task_id, {
        attempt_id: attempt.attempt_id,
        decision_id: decision.decision_id,
      });

      const active = this.activeAttempts.get(attempt.attempt_id);
      if (active && this.options.executor.cancel) {
        const cancellation = await this.options.executor.cancel({
          task: active.task,
          decision: active.decision,
          attempt: { ...active.attempt, status: 'cancel_requested' },
        });
        if (cancellation === 'cancelled') {
          await this.confirmCancellation(context, active.task, active.attempt);
        }
      }
    }

    return this.projectExecution(attempt, context, attempt.status !== 'running');
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
    return this.projectExecution(attempt, context, true);
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
    this.assertExecutableDecision(task, decision);

    if (task.status === 'planning') {
      await this.transitionTask(task.task_id, 'approved', 'planning');
      await this.recordAudit(context, 'task.execution.approved', task.task_id, {
        decision_id: decision.decision_id,
      });
    } else if (task.status !== 'approved') {
      throw new ExecutionRequestError(
        'invalid_task_state',
        `Task cannot be executed from status ${task.status}`
      );
    }

    const policy = await this.currentPolicy(context, decision);
    const retryPolicy = normalizeRetryPolicy(policy.retry_policy);
    await this.assertBudget(context, decision, policy);

    const executionId = `execution_${generateId()}`;
    let rootAttempt: ExecutionAttempt;
    try {
      rootAttempt = await repositories.executions.createAttempt({
        attempt_id: `attempt_${generateId()}`,
        account_id: context.account.account_id,
        execution_id: executionId,
        task_id: task.task_id,
        decision_id: decision.decision_id,
        idempotency_key: request.idempotency_key,
        status: 'pending',
        started_at: null,
        completed_at: null,
        cancel_requested_at: null,
        cancelled_at: null,
        retry_count: 0,
        retry_policy: retryPolicy,
        parent_attempt_id: null,
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

    return this.executeAttemptLoop(
      context,
      { ...task, status: 'approved' },
      decision,
      rootAttempt,
      request,
      retryPolicy,
      decision.estimated_cost ?? 0
    );
  }

  private async executeAttemptLoop(
    context: AuthorizedExecutionContext,
    task: Task,
    initialDecision: RoutingDecision,
    initialAttempt: ExecutionAttempt,
    request: ExecutionRequest,
    retryPolicy: NormalizedRetryPolicy,
    initialEstimatedCost: number
  ): Promise<ExecutionProjection> {
    let decision = initialDecision;
    let attempt = initialAttempt;
    let retryCount = 0;
    let fallbackCount = 0;
    let estimatedTotalCost = initialEstimatedCost;
    const attemptedRouteIds = new Set<string>();
    if (decision.route_snapshot) attemptedRouteIds.add(decision.route_snapshot.route_id);

    while (true) {
      const result = await this.executeAttempt(context, task, decision, attempt);
      if (result.outcome === 'accepted' || result.outcome === 'cancelled') {
        return this.projectExecution(initialAttempt, context, false);
      }
      if (result.outcome === 'terminal_failure') {
        await this.failTask(task.task_id);
        return this.projectExecution(initialAttempt, context, false);
      }

      if (retryCount < retryPolicy.max_retries) {
        const nextRetry = retryCount + 1;
        const delay =
          retryPolicy.initial_delay_ms * Math.pow(retryPolicy.backoff_multiplier, nextRetry - 1);
        await this.recordAudit(context, 'task.execution.retry_scheduled', task.task_id, {
          attempt_id: attempt.attempt_id,
          decision_id: decision.decision_id,
          retry_count: nextRetry,
          delay_ms: delay,
        });
        await this.scheduler.schedule(delay);

        const policy = await this.currentPolicy(context, decision);
        if (
          !this.canAffordAdditionalCost(retryPolicy, estimatedTotalCost, decision.estimated_cost)
        ) {
          await this.recordAudit(context, 'task.execution.retry_exhausted', task.task_id, {
            attempt_id: attempt.attempt_id,
            reason: 'cost_limit',
          });
          await this.failTask(task.task_id);
          return this.projectExecutionWithFailure(initialAttempt, context, 'budget_denied');
        }
        try {
          await this.assertBudget(context, decision, policy);
        } catch {
          await this.recordAudit(context, 'task.execution.retry_exhausted', task.task_id, {
            attempt_id: attempt.attempt_id,
            reason: 'budget_denied',
          });
          await this.failTask(task.task_id);
          return this.projectExecutionWithFailure(initialAttempt, context, 'budget_denied');
        }

        const nextAttempt = await this.createChildAttempt(
          context,
          attempt,
          decision,
          request.idempotency_key,
          retryCount + 1,
          retryPolicy
        );
        estimatedTotalCost += decision.estimated_cost ?? 0;
        retryCount = nextRetry;
        attempt = nextAttempt;
        continue;
      }

      await this.recordAudit(context, 'task.execution.retry_exhausted', task.task_id, {
        attempt_id: attempt.attempt_id,
        decision_id: decision.decision_id,
        retry_count: retryCount,
      });

      if (retryPolicy.fallback_enabled && fallbackCount < retryPolicy.max_fallbacks) {
        const fallback = await this.createFallbackDecision(task, decision, attemptedRouteIds);
        if (fallback) {
          const fallbackCost = fallback.estimated_cost ?? 0;
          if (
            !this.canAffordAdditionalCost(retryPolicy, estimatedTotalCost, fallback.estimated_cost)
          ) {
            await this.recordAudit(context, 'routing.fallback', task.task_id, {
              parent_decision_id: decision.decision_id,
              outcome: 'denied',
              reason: 'cost_limit',
            });
          } else {
            try {
              const fallbackPolicy = await this.currentPolicy(context, fallback);
              await this.assertBudget(context, fallback, fallbackPolicy);
              await this.recordAudit(context, 'routing.fallback', task.task_id, {
                parent_decision_id: decision.decision_id,
                fallback_decision_id: fallback.decision_id,
                outcome: 'selected',
              });
              fallbackCount += 1;
              estimatedTotalCost += fallbackCost;
              decision = fallback;
              retryCount = 0;
              if (fallback.route_snapshot) attemptedRouteIds.add(fallback.route_snapshot.route_id);
              attempt = await this.createChildAttempt(
                context,
                attempt,
                decision,
                request.idempotency_key,
                0,
                retryPolicy
              );
              continue;
            } catch {
              await this.recordAudit(context, 'routing.fallback', task.task_id, {
                parent_decision_id: decision.decision_id,
                outcome: 'denied',
                reason: 'budget_or_policy_denied',
              });
            }
          }
        } else {
          await this.recordAudit(context, 'routing.fallback', task.task_id, {
            parent_decision_id: decision.decision_id,
            outcome: 'denied',
            reason: 'no_admissible_route',
          });
        }
      }

      await this.failTask(task.task_id);
      return this.projectExecution(initialAttempt, context, false);
    }
  }

  private async executeAttempt(
    context: AuthorizedExecutionContext,
    task: Task,
    decision: RoutingDecision,
    attempt: ExecutionAttempt
  ): Promise<AttemptResult> {
    await this.options.beforeDispatch?.(attempt);
    try {
      await this.options.repositories.executions.updateAttemptStatus(
        attempt.attempt_id,
        'running',
        { started_at: this.now() },
        'pending'
      );
    } catch {
      const current = await this.options.repositories.executions.getAttempt(attempt.attempt_id);
      if (current?.status === 'cancelled') return { outcome: 'cancelled', failure_code: null };
      throw new ExecutionRequestError('invalid_task_state', 'Execution attempt transition failed');
    }

    const runningAttempt: ExecutionAttempt = {
      ...attempt,
      status: 'running',
      started_at: this.now(),
    };
    this.activeAttempts.set(attempt.attempt_id, {
      context,
      task,
      decision,
      attempt: runningAttempt,
    });

    try {
      if (task.status === 'approved')
        await this.transitionTask(task.task_id, 'executing', 'approved');
      await this.recordAudit(context, 'task.execution.started', task.task_id, {
        attempt_id: attempt.attempt_id,
        decision_id: decision.decision_id,
      });

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
      } catch (error) {
        const current = await this.options.repositories.executions.getAttempt(attempt.attempt_id);
        if (error instanceof ExecutionCancelledError || current?.status === 'cancel_requested') {
          await this.confirmCancellation(context, task, attempt);
          return { outcome: 'cancelled', failure_code: null };
        }
      }

      let usage: UsageRecord | null = null;
      if (output) {
        try {
          usage = await this.reconcileUsage(
            context,
            runningAttempt,
            decision.estimated_cost,
            output
          );
        } catch {
          verification = {
            outcome: 'terminal_failure',
            failure_code: 'usage_reconciliation_failed',
          };
        }
      }

      const current = await this.options.repositories.executions.getAttempt(attempt.attempt_id);
      if (current?.status === 'cancel_requested' && verification.outcome !== 'accepted') {
        await this.confirmCancellation(context, task, attempt);
        return { outcome: 'cancelled', failure_code: null };
      }
      if (current?.status === 'cancelled') return { outcome: 'cancelled', failure_code: null };

      if (verification.outcome === 'accepted') {
        await this.options.repositories.executions.updateAttemptStatus(
          attempt.attempt_id,
          'completed',
          { completed_at: this.now(), verification_outcome: 'accepted', failure_code: null },
          current?.status === 'cancel_requested' ? 'cancel_requested' : 'running'
        );
        await this.transitionTask(task.task_id, 'completed', 'executing');
        await this.recordAudit(context, 'task.execution.completed', task.task_id, {
          attempt_id: attempt.attempt_id,
          decision_id: decision.decision_id,
        });
        return { outcome: 'accepted', failure_code: null };
      }

      const failureCode = safeFailureCode(
        verification.failure_code,
        verification.outcome === 'retryable_failure'
          ? 'retryable_failure'
          : 'terminal_verification_failure'
      );
      await this.options.repositories.executions.updateAttemptStatus(
        attempt.attempt_id,
        'failed',
        {
          completed_at: this.now(),
          verification_outcome: verification.outcome,
          failure_code: failureCode,
        },
        'running'
      );
      await this.recordAudit(context, 'task.execution.failed', task.task_id, {
        attempt_id: attempt.attempt_id,
        decision_id: decision.decision_id,
        failure_code: failureCode,
        usage_id: usage?.usage_id ?? null,
      });
      return {
        outcome: isRetryable(verification, normalizeRetryPolicy(attempt.retry_policy))
          ? 'retryable_failure'
          : 'terminal_failure',
        failure_code: failureCode,
      };
    } finally {
      this.activeAttempts.delete(attempt.attempt_id);
    }
  }

  private async createChildAttempt(
    context: AuthorizedExecutionContext,
    parent: ExecutionAttempt,
    decision: RoutingDecision,
    idempotencyKey: string,
    retryCount: number,
    retryPolicy: NormalizedRetryPolicy
  ): Promise<ExecutionAttempt> {
    return this.options.repositories.executions.createAttempt({
      attempt_id: `attempt_${generateId()}`,
      account_id: context.account.account_id,
      execution_id: parent.execution_id,
      task_id: parent.task_id,
      decision_id: decision.decision_id,
      idempotency_key: idempotencyKey,
      status: 'pending',
      started_at: null,
      completed_at: null,
      cancel_requested_at: null,
      cancelled_at: null,
      retry_count: retryCount,
      retry_policy: retryPolicy,
      parent_attempt_id: parent.attempt_id,
      verification_outcome: null,
      failure_code: null,
    });
  }

  private async createFallbackDecision(
    task: Task,
    originalDecision: RoutingDecision,
    attemptedRouteIds: Set<string>
  ): Promise<RoutingDecision | null> {
    if (!this.options.fallbackPlanner) return null;
    const planned = await this.options.fallbackPlanner.planFallback({
      task,
      original_decision: structuredClone(originalDecision),
      excluded_route_ids: [...attemptedRouteIds],
    });
    if (
      !planned ||
      !planned.selected_route_id ||
      !planned.route_snapshot ||
      planned.route_snapshot.route_id === originalDecision.route_snapshot?.route_id
    ) {
      return null;
    }
    const decisionToCreate = (({ decided_at: _decidedAt, ...rest }) => rest)({
      ...planned,
      parent_decision_id: originalDecision.decision_id,
      fallback_reason: 'retry_exhausted',
    });
    return this.options.repositories.decisions.createDecision(decisionToCreate);
  }

  private async currentPolicy(context: AuthorizedExecutionContext, decision: RoutingDecision) {
    const policy = await this.options.repositories.policies.getPolicy(decision.policy_id);
    if (!policy || policy.account_id !== context.account.account_id) {
      throw new ExecutionRequestError('policy_unavailable', 'Execution policy is unavailable');
    }
    return policy;
  }

  private async assertBudget(
    context: AuthorizedExecutionContext,
    decision: RoutingDecision,
    policy: Awaited<ReturnType<ExecutionCoordinator['currentPolicy']>>
  ): Promise<void> {
    if (decision.estimated_cost === null) {
      throw new ExecutionRequestError('budget_denied', 'Execution estimate is unavailable');
    }
    const budget = await this.options.budgetEnforcer.checkBudget(
      context.account.account_id,
      decision.estimated_cost,
      policy
    );
    if (!budget.allowed)
      throw new ExecutionRequestError('budget_denied', 'Execution budget denied');
  }

  private canAffordAdditionalCost(
    policy: NormalizedRetryPolicy,
    currentTotal: number,
    additional: number | null
  ): boolean {
    if (additional === null) return false;
    return (
      policy.max_total_estimated_cost === null ||
      currentTotal + additional <= policy.max_total_estimated_cost
    );
  }

  private assertExecutableDecision(task: Task, decision: RoutingDecision): void {
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
  }

  private async transitionTask(
    taskId: string,
    status: Task['status'],
    expected: Task['status']
  ): Promise<void> {
    try {
      await this.options.repositories.tasks.updateTaskStatus(taskId, status, expected);
    } catch {
      const current = await this.options.repositories.tasks.getTask(taskId);
      if (current?.status !== status)
        throw new ExecutionRequestError('invalid_task_state', 'Task transition failed');
    }
  }

  private async failTask(taskId: string): Promise<void> {
    const task = await this.options.repositories.tasks.getTask(taskId);
    if (task?.status === 'executing') {
      await this.transitionTask(taskId, 'failed', 'executing');
    }
  }

  private async confirmCancellation(
    context: AuthorizedExecutionContext,
    task: Task,
    attempt: ExecutionAttempt
  ): Promise<void> {
    const current = await this.options.repositories.executions.getAttempt(attempt.attempt_id);
    if (!current || current.status === 'cancelled' || current.status === 'completed') return;
    if (current.status === 'pending' || current.status === 'cancel_requested') {
      await this.options.repositories.executions.updateAttemptStatus(
        attempt.attempt_id,
        'cancelled',
        { cancelled_at: this.now() },
        current.status
      );
      await this.transitionTaskIfExecuting(task.task_id, 'cancelled');
      await this.recordAudit(context, 'task.execution.cancelled', task.task_id, {
        attempt_id: attempt.attempt_id,
      });
    }
  }

  private async transitionTaskIfExecuting(taskId: string, status: Task['status']): Promise<void> {
    const task = await this.options.repositories.tasks.getTask(taskId);
    if (task?.status === 'executing') await this.transitionTask(taskId, status, 'executing');
  }

  private async reconcileUsage(
    context: AuthorizedExecutionContext,
    attempt: ExecutionAttempt,
    estimatedCost: number | null,
    output: ExecutionOutput
  ): Promise<UsageRecord> {
    if (estimatedCost === null)
      throw new ExecutionRequestError('budget_denied', 'Execution estimate is unavailable');
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
      cost_variance: output.actual_cost !== null ? output.actual_cost - estimatedCost : null,
    });
    await this.recordAudit(context, 'usage.reconciled', attempt.task_id, {
      attempt_id: attempt.attempt_id,
      usage_id: usage.usage_id,
      actual_cost: usage.actual_cost,
    });
    return usage;
  }

  private async projectExecution(
    rootAttempt: ExecutionAttempt,
    context: AuthorizedExecutionContext,
    replayed: boolean
  ): Promise<ExecutionProjection> {
    const task = await this.options.repositories.tasks.getTask(rootAttempt.task_id);
    if (!task || task.account_id !== context.account.account_id) {
      throw new ExecutionRequestError('access_denied', 'Access denied');
    }
    const attempts = (await this.options.repositories.executions.listAttemptsForTask(task.task_id))
      .filter((attempt) => attempt.execution_id === rootAttempt.execution_id)
      .sort((a, b) => a.created_at.getTime() - b.created_at.getTime());
    const latest = attempts.at(-1) ?? rootAttempt;
    const decisions = new Map<string, RoutingDecision>();
    for (const attempt of attempts) {
      const decision = await this.options.repositories.decisions.getDecision(attempt.decision_id);
      if (decision) decisions.set(decision.decision_id, decision);
    }
    const usage = await Promise.all(
      attempts.map((attempt) =>
        this.options.repositories.usage.getUsageForAttempt(attempt.attempt_id)
      )
    );
    const records = usage.filter((record): record is UsageRecord => record !== null);
    const latestDecision = decisions.get(latest.decision_id);
    return {
      task_id: task.task_id,
      decision_id: latest.decision_id,
      root_decision_id: rootAttempt.decision_id,
      execution_id: rootAttempt.execution_id,
      root_attempt_id: rootAttempt.attempt_id,
      attempt_id: latest.attempt_id,
      attempt_ids: attempts.map((attempt) => attempt.attempt_id),
      decision_ids: [...decisions.keys()],
      retry_count: latest.retry_count,
      fallback_count: Math.max(0, decisions.size - 1),
      status: latest.status,
      task_status: task.status,
      execution_status: latest.status,
      verification_outcome: latest.verification_outcome,
      failure_code: latest.failure_code,
      estimated_cost: latestDecision?.estimated_cost ?? null,
      estimated_total_cost: [...decisions.values()].reduce(
        (sum, decision) => sum + (decision.estimated_cost ?? 0),
        0
      ),
      actual_cost: records.reduce((sum, record) => sum + (record.actual_cost ?? 0), 0),
      usage_id: records.at(-1)?.usage_id ?? null,
      replayed,
      data_mode: 'synthetic_execution',
    };
  }

  private async projectExecutionWithFailure(
    rootAttempt: ExecutionAttempt,
    context: AuthorizedExecutionContext,
    failureCode: string
  ): Promise<ExecutionProjection> {
    const projection = await this.projectExecution(rootAttempt, context, false);
    return {
      ...projection,
      status: 'failed',
      execution_status: 'failed',
      failure_code: failureCode,
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
      this.options.onAuditFailure?.();
    }
  }
}
