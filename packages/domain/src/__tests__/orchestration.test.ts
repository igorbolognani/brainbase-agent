import { describe, it, expect, beforeEach } from 'vitest';
import { OrchestrationGraphBuilder } from '../orchestration-graph.js';
import { OrchestrationOrchestrator } from '../orchestration-orchestrator.js';

// ============================================================================
// Orchestration Graph Builder
// ============================================================================

describe('OrchestrationGraphBuilder', () => {
  it('creates graph with defaults', () => {
    const builder = new OrchestrationGraphBuilder({
      execution_id: 'exec-1',
      account_id: 'acc-1',
      task_id: 'task-1',
      mode: 'single',
    });
    const graph = builder.getGraph();
    expect(graph.execution_id).toBe('exec-1');
    expect(graph.account_id).toBe('acc-1');
    expect(graph.task_id).toBe('task-1');
    expect(graph.mode).toBe('single');
    expect(graph.status).toBe('pending');
    expect(graph.max_nodes).toBe(10);
    expect(graph.max_parallel).toBe(4);
  });

  it('builds single mode', () => {
    const builder = new OrchestrationGraphBuilder({
      execution_id: 'exec-1',
      account_id: 'acc-1',
      task_id: 'task-1',
      mode: 'single',
    });
    builder.buildForMode('single');
    expect(builder.getNodes()).toHaveLength(1);
    expect(builder.getNodes()[0].role).toBe('root');
  });

  it('builds fallback mode', () => {
    const builder = new OrchestrationGraphBuilder({
      execution_id: 'exec-1',
      account_id: 'acc-1',
      task_id: 'task-1',
      mode: 'fallback',
    });
    builder.buildForMode('fallback');
    expect(builder.getNodes()).toHaveLength(3);
    expect(builder.getNodes().filter((n) => n.role === 'worker')).toHaveLength(2);
  });

  it('builds parallel_candidates mode', () => {
    const builder = new OrchestrationGraphBuilder({
      execution_id: 'exec-1',
      account_id: 'acc-1',
      task_id: 'task-1',
      mode: 'parallel_candidates',
    });
    builder.buildForMode('parallel_candidates');
    expect(builder.getNodes()).toHaveLength(4);
    expect(builder.getNodes().filter((n) => n.role === 'candidate')).toHaveLength(3);
  });

  it('builds planner_worker_reviewer mode', () => {
    const builder = new OrchestrationGraphBuilder({
      execution_id: 'exec-1',
      account_id: 'acc-1',
      task_id: 'task-1',
      mode: 'planner_worker_reviewer',
    });
    builder.buildForMode('planner_worker_reviewer');
    expect(builder.getNodes()).toHaveLength(4);
    const roles = builder.getNodes().map((n) => n.role);
    expect(roles).toContain('root');
    expect(roles).toContain('planner');
    expect(roles).toContain('worker');
    expect(roles).toContain('reviewer');
  });

  it('enforces node limit', () => {
    const builder = new OrchestrationGraphBuilder({
      execution_id: 'exec-1',
      account_id: 'acc-1',
      task_id: 'task-1',
      mode: 'single',
      max_nodes: 1,
    });
    builder.addNode({ role: 'worker' });
    expect(() => builder.addNode({ role: 'worker' })).toThrow('Node limit 1 reached');
  });

  it('finds runnable nodes (no parent)', () => {
    const builder = new OrchestrationGraphBuilder({
      execution_id: 'exec-1',
      account_id: 'acc-1',
      task_id: 'task-1',
      mode: 'single',
    });
    builder.buildForMode('single');
    expect(builder.getRunnableNodes()).toHaveLength(1);
    expect(builder.getRunnableNodes()[0].role).toBe('root');
  });

  it('finds runnable nodes when parent completed', () => {
    const builder = new OrchestrationGraphBuilder({
      execution_id: 'exec-1',
      account_id: 'acc-1',
      task_id: 'task-1',
      mode: 'fallback',
    });
    builder.buildForMode('fallback');
    const root = builder.getNodes()[0];
    builder.updateNodeStatus(root.node_id, 'completed');
    const runnable = builder.getRunnableNodes();
    expect(runnable).toHaveLength(2);
  });

  it('not runnable if parent still pending', () => {
    const builder = new OrchestrationGraphBuilder({
      execution_id: 'exec-1',
      account_id: 'acc-1',
      task_id: 'task-1',
      mode: 'fallback',
    });
    builder.buildForMode('fallback');
    expect(builder.getRunnableNodes()).toHaveLength(1);
  });

  it('tracks parallel slots', () => {
    const builder = new OrchestrationGraphBuilder({
      execution_id: 'exec-1',
      account_id: 'acc-1',
      task_id: 'task-1',
      mode: 'parallel_candidates',
      max_parallel: 2,
    });
    builder.buildForMode('parallel_candidates');
    expect(builder.getParallelSlots()).toBe(2);

    const root = builder.getNodes()[0];
    builder.updateNodeStatus(root.node_id, 'completed');
    const runnable = builder.getRunnableNodes();
    builder.updateNodeStatus(runnable[0].node_id, 'running');
    expect(builder.getParallelSlots()).toBe(1);
    builder.updateNodeStatus(runnable[1].node_id, 'running');
    expect(builder.getParallelSlots()).toBe(0);
  });

  it('detects completion', () => {
    const builder = new OrchestrationGraphBuilder({
      execution_id: 'exec-1',
      account_id: 'acc-1',
      task_id: 'task-1',
      mode: 'single',
    });
    builder.buildForMode('single');
    expect(builder.isComplete()).toBe(false);
    builder.updateNodeStatus(builder.getNodes()[0].node_id, 'completed');
    expect(builder.isComplete()).toBe(true);
  });

  it('detects failure', () => {
    const builder = new OrchestrationGraphBuilder({
      execution_id: 'exec-1',
      account_id: 'acc-1',
      task_id: 'task-1',
      mode: 'single',
    });
    builder.buildForMode('single');
    builder.updateNodeStatus(builder.getNodes()[0].node_id, 'failed');
    expect(builder.hasFailed()).toBe(true);
  });
});

// ============================================================================
// Orchestration Orchestrator
// ============================================================================

describe('OrchestrationOrchestrator', () => {
  let orchestrator: OrchestrationOrchestrator;

  beforeEach(() => {
    orchestrator = new OrchestrationOrchestrator();
  });

  it('creates graph and returns builder', () => {
    const builder = orchestrator.createGraph({
      execution_id: 'exec-1',
      account_id: 'acc-1',
      task_id: 'task-1',
      mode: 'single',
    });
    expect(builder.getGraph().graph_id).toBeDefined();
    expect(builder.getNodes()).toHaveLength(1);
  });

  it('executes single node graph', async () => {
    const builder = orchestrator.createGraph({
      execution_id: 'exec-1',
      account_id: 'acc-1',
      task_id: 'task-1',
      mode: 'single',
    });

    const result = await orchestrator.executeGraph(
      builder.getGraph().graph_id,
      async (_nodeId, _role) => ({
        output: { result: 'ok' },
        status: 'completed' as const,
      })
    );

    expect(result.status).toBe('completed');
    expect(result.node_results).toHaveLength(1);
    expect(result.node_results[0].status).toBe('completed');
  });

  it('executes fallback graph with workers', async () => {
    const builder = orchestrator.createGraph({
      execution_id: 'exec-1',
      account_id: 'acc-1',
      task_id: 'task-1',
      mode: 'fallback',
    });

    const result = await orchestrator.executeGraph(
      builder.getGraph().graph_id,
      async (_nodeId, role) => ({
        output: { role },
        status: 'completed' as const,
      })
    );

    expect(result.status).toBe('completed');
    expect(result.node_results).toHaveLength(3);
  });

  it('handles node failure', async () => {
    const builder = orchestrator.createGraph({
      execution_id: 'exec-1',
      account_id: 'acc-1',
      task_id: 'task-1',
      mode: 'single',
    });

    const result = await orchestrator.executeGraph(builder.getGraph().graph_id, async () => ({
      output: undefined,
      status: 'failed' as const,
    }));

    expect(result.status).toBe('failed');
  });

  it('cancels graph', () => {
    const builder = orchestrator.createGraph({
      execution_id: 'exec-1',
      account_id: 'acc-1',
      task_id: 'task-1',
      mode: 'parallel_candidates',
    });

    orchestrator.cancelGraph(builder.getGraph().graph_id);
    const graph = builder.getGraph();
    expect(graph.status).toBe('failed');
    expect(builder.getNodes().every((n) => n.status === 'cancelled')).toBe(true);
  });

  it('throws for unknown graph', async () => {
    await expect(
      orchestrator.executeGraph('unknown', async () => ({
        output: null,
        status: 'completed' as const,
      }))
    ).rejects.toThrow('Graph unknown not found');
  });
});
