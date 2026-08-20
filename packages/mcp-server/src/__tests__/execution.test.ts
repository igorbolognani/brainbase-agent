import { describe, expect, it } from 'vitest';
import {
  createSyntheticGPTRouterApplication,
  SYNTHETIC_ACCOUNT_ID,
  SYNTHETIC_ISSUER,
} from '../application.js';
import { createGPTRouterHandlers } from '../handlers.js';
import { DeterministicVerifier, SyntheticExecutor, type ExecutionOutput } from '@gptrouter/domain';
import { AuthorizationError } from '@gptrouter/security';

function parseText(result: { content: Array<{ type: string; text: string }> }) {
  return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

async function plannedExecution(
  application = createSyntheticGPTRouterApplication(),
  description = 'Synthetic execution test'
) {
  const handlers = createGPTRouterHandlers(application);
  const planned = parseText(
    await handlers.routeTaskHandler({
      description,
      required_capabilities: ['text', 'vision'],
      ordering_strategy: 'cost',
    })
  );
  return { application, handlers, planned };
}

const executionArgs = (planned: Record<string, unknown>, idempotency_key = 'idem-1') => ({
  task_id: planned.task_id as string,
  decision_id: planned.decision_id as string,
  idempotency_key,
});

describe('Phase 1A synthetic execution', () => {
  it('keeps route_task planning-only and executes only after explicit run_task', async () => {
    const executor = new SyntheticExecutor();
    const { application, handlers, planned } = await plannedExecution(
      createSyntheticGPTRouterApplication({ executor })
    );

    expect(planned.status).toBe('planning');
    expect(planned.actual_cost).toBe(0);
    expect(executor.invocationCount).toBe(0);

    const result = parseText(await handlers.runTaskHandler(executionArgs(planned)));
    expect(result.status).toBe('completed');
    expect(result.task_status).toBe('completed');
    expect(result.execution_status).toBe('completed');
    expect(result.verification_outcome).toBe('accepted');
    expect(result.estimated_cost).toBeGreaterThan(0);
    expect(result.actual_cost).toBe(0);
    expect(result.replayed).toBe(false);
    expect(executor.invocationCount).toBe(1);

    const audit = await application.getAuditEvents();
    expect(audit.map((event) => event.event_type).reverse()).toEqual([
      'task.execution.approved',
      'task.execution.started',
      'usage.reconciled',
      'task.execution.completed',
    ]);
  });

  it('replays one sequential idempotent execution without a second dispatch or usage record', async () => {
    const executor = new SyntheticExecutor();
    const { handlers, planned } = await plannedExecution(
      createSyntheticGPTRouterApplication({ executor })
    );
    const args = executionArgs(planned);

    const first = parseText(await handlers.runTaskHandler(args));
    const replay = parseText(await handlers.runTaskHandler(args));
    const usage = parseText(await handlers.getUsageHandler({ time_range: 'month' }));

    expect(replay.attempt_id).toBe(first.attempt_id);
    expect(replay.replayed).toBe(true);
    expect(executor.invocationCount).toBe(1);
    expect(usage.execution_requests).toBe(1);
    expect(usage.actual_usage_records).toBe(1);
    expect(usage.actual_cost).toBe(0);
  });

  it('coalesces concurrent duplicate requests into one dispatch', async () => {
    const executor = new SyntheticExecutor();
    const { handlers, planned } = await plannedExecution(
      createSyntheticGPTRouterApplication({ executor })
    );
    const args = executionArgs(planned, 'concurrent-idem');

    const results = await Promise.all(
      Array.from({ length: 8 }, () => handlers.runTaskHandler(args).then(parseText))
    );

    expect(new Set(results.map((result) => result.attempt_id)).size).toBe(1);
    expect(executor.invocationCount).toBe(1);
    expect(parseText(await handlers.getUsageHandler({})).actual_usage_records).toBe(1);
  });

  it('rejects reuse of an idempotency key for a different task or decision', async () => {
    const executor = new SyntheticExecutor();
    const application = createSyntheticGPTRouterApplication({ executor });
    const first = await plannedExecution(application, 'First task');
    const second = await plannedExecution(application, 'Second task');
    await first.handlers.runTaskHandler(executionArgs(first.planned, 'conflict-key'));

    await expect(
      first.handlers.runTaskHandler(executionArgs(second.planned, 'conflict-key'))
    ).rejects.toMatchObject({ code: 'idempotency_conflict' });
    expect(executor.invocationCount).toBe(1);
  });

  it('denies a task/decision mismatch before dispatch', async () => {
    const executor = new SyntheticExecutor();
    const application = createSyntheticGPTRouterApplication({ executor });
    const first = await plannedExecution(application, 'First task');
    const second = await plannedExecution(application, 'Second task');

    await expect(
      first.handlers.runTaskHandler({
        task_id: first.planned.task_id as string,
        decision_id: second.planned.decision_id as string,
        idempotency_key: 'mismatch-key',
      })
    ).rejects.toMatchObject({ code: 'decision_task_mismatch' });
    expect(executor.invocationCount).toBe(0);
  });

  it('fails closed for remote execution without verified authentication', async () => {
    const executor = new SyntheticExecutor();
    const application = createSyntheticGPTRouterApplication({
      executor,
      requireAuthorizedExecution: true,
    });
    const { planned } = await plannedExecution(application);

    await expect(application.runTask(executionArgs(planned))).rejects.toBeInstanceOf(
      AuthorizationError
    );
    expect(executor.invocationCount).toBe(0);
  });

  it('maps verified identity through principal, membership, and account authorization', async () => {
    const application = createSyntheticGPTRouterApplication({ requireAuthorizedExecution: true });
    const context = await application.authorizeVerifiedIdentity({
      issuer: SYNTHETIC_ISSUER,
      subject: 'principal-synthetic-v0',
      account_id: SYNTHETIC_ACCOUNT_ID,
    });

    expect(context.account.account_id).toBe(SYNTHETIC_ACCOUNT_ID);
    expect(context.membership.role).toBe('owner');
    expect(context.principal.subject).toBe('principal-synthetic-v0');
  });

  it('denies a foreign account context without invoking the executor', async () => {
    const executor = new SyntheticExecutor();
    const application = createSyntheticGPTRouterApplication({ executor });
    const { planned } = await plannedExecution(application);
    const foreignContext = application.getSyntheticAuthorizedContext();
    foreignContext.account.account_id = 'account-foreign';

    await expect(application.runTask(executionArgs(planned), foreignContext)).rejects.toMatchObject(
      {
        code: 'access_denied',
        message: 'Access denied',
      }
    );
    expect(executor.invocationCount).toBe(0);
  });

  it('records a failed attempt and no usage when the executor fails', async () => {
    const executor = new SyntheticExecutor({ fail: true });
    const { handlers, planned } = await plannedExecution(
      createSyntheticGPTRouterApplication({ executor })
    );

    const result = parseText(await handlers.runTaskHandler(executionArgs(planned)));
    const task = parseText(await handlers.getTaskHandler({ task_id: planned.task_id as string }));
    const usage = parseText(await handlers.getUsageHandler({}));

    expect(result.status).toBe('failed');
    expect(result.failure_code).toBe('executor_failure');
    expect((task.task as { status: string }).status).toBe('failed');
    expect((task.attempts as Array<{ status: string }>)[0].status).toBe('failed');
    expect(usage.actual_usage_records).toBe(0);
  });

  it('reconciles exactly one zero-cost usage record when verification fails', async () => {
    const executor = new SyntheticExecutor();
    const { handlers, planned } = await plannedExecution(
      createSyntheticGPTRouterApplication({
        executor,
        verifier: new DeterministicVerifier('terminal_failure', 'verifier_failure'),
      })
    );

    const result = parseText(await handlers.runTaskHandler(executionArgs(planned)));
    const usage = parseText(await handlers.getUsageHandler({}));
    const replay = parseText(await handlers.runTaskHandler(executionArgs(planned)));

    expect(result.status).toBe('failed');
    expect(result.failure_code).toBe('verifier_failure');
    expect(result.actual_cost).toBe(0);
    expect(usage.actual_usage_records).toBe(1);
    expect(usage.actual_cost).toBe(0);
    expect(replay.attempt_id).toBe(result.attempt_id);
    expect(executor.invocationCount).toBe(1);
  });

  it('keeps read tools and dashboard projection non-consequential', async () => {
    const executor = new SyntheticExecutor();
    const application = createSyntheticGPTRouterApplication({ executor });
    const handlers = createGPTRouterHandlers(application);
    const planned = parseText(
      await handlers.routeTaskHandler({
        description: 'Read-only checks',
        required_capabilities: ['text'],
        ordering_strategy: 'cost',
      })
    );

    await handlers.getTaskHandler({ task_id: planned.task_id as string });
    await handlers.getUsageHandler({});
    const dashboard = await application.getDashboardSummary();

    expect(executor.invocationCount).toBe(0);
    expect(dashboard.synthetic_execution_enabled).toBe(true);
    expect(dashboard.provider_execution_enabled).toBe(false);
    expect(dashboard.paid_calls_enabled).toBe(false);
  });

  it('does not expose hostile execution metadata through public projections or audit', async () => {
    const hostileValue = 'synthetic-hostile-secret-value';
    const executor = {
      async execute(): Promise<ExecutionOutput> {
        return {
          provider_usage_data: { authorization: hostileValue },
          actual_cost: 0,
          cost_breakdown: { execution_mode: 'synthetic' },
          tokens_used: { input: 0, output: 0 },
        };
      },
    };
    const application = createSyntheticGPTRouterApplication({ executor });
    const { handlers, planned } = await plannedExecution(application);
    const run = parseText(await handlers.runTaskHandler(executionArgs(planned)));
    const task = parseText(await handlers.getTaskHandler({ task_id: planned.task_id as string }));
    const usage = parseText(await handlers.getUsageHandler({}));
    const audit = await application.getAuditEvents();

    expect(JSON.stringify({ run, task, usage, audit })).not.toContain(hostileValue);
  });
});
