import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OrchestrationGraphBuilder } from '../orchestration-graph.js';
import { OrchestrationOrchestrator } from '../orchestration-orchestrator.js';
import type { OrchestratorStore } from '../orchestration-orchestrator.js';
import type { OrchestrationGraph, OrchestrationNode } from '@gptrouter/contracts';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ============================================================================
// Orchestration Graph Builder
// ============================================================================

describe('OrchestrationGraphBuilder', () => {
  it('creates graph with default limits', () => {
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
    expect(graph.limits).toBeDefined();
    expect(graph.limits.max_nodes).toBeGreaterThan(0);
    expect(graph.limits.max_parallel).toBeGreaterThan(0);
  });

  it('accepts custom limits', () => {
    const builder = new OrchestrationGraphBuilder({
      execution_id: 'exec-1',
      account_id: 'acc-1',
      task_id: 'task-1',
      mode: 'single',
      limits: { max_nodes: 5, max_parallel: 2 },
    });
    const graph = builder.getGraph();
    expect(graph.limits.max_nodes).toBe(5);
    expect(graph.limits.max_parallel).toBe(2);
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

  it('builds fallback mode with one worker (2 nodes total)', () => {
    const builder = new OrchestrationGraphBuilder({
      execution_id: 'exec-1',
      account_id: 'acc-1',
      task_id: 'task-1',
      mode: 'fallback',
    });
    builder.buildForMode('fallback');
    const nodes = builder.getNodes();
    expect(nodes).toHaveLength(2);
    expect(nodes.filter((n) => n.role === 'root')).toHaveLength(1);
    expect(nodes.filter((n) => n.role === 'worker')).toHaveLength(1);
    expect(nodes[1].parent_node_id).toBe(nodes[0].node_id);
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

  it('enforces node limit via limits', () => {
    const builder = new OrchestrationGraphBuilder({
      execution_id: 'exec-1',
      account_id: 'acc-1',
      task_id: 'task-1',
      mode: 'single',
      limits: { max_nodes: 1 },
    });
    builder.buildForMode('single');
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
    expect(builder.getRunnableNodes()).toHaveLength(1);
    builder.updateNodeStatus(root.node_id, 'completed');
    const runnable = builder.getRunnableNodes();
    expect(runnable).toHaveLength(1);
    expect(runnable[0].role).toBe('worker');
  });

  it('tracks parallel slots using limits.max_parallel', () => {
    const builder = new OrchestrationGraphBuilder({
      execution_id: 'exec-1',
      account_id: 'acc-1',
      task_id: 'task-1',
      mode: 'parallel_candidates',
      limits: { max_parallel: 2 },
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

  it('detects completion and failure', () => {
    const builder = new OrchestrationGraphBuilder({
      execution_id: 'exec-1',
      account_id: 'acc-1',
      task_id: 'task-1',
      mode: 'single',
    });
    builder.buildForMode('single');
    expect(builder.isComplete()).toBe(false);
    expect(builder.hasFailed()).toBe(false);

    builder.updateNodeStatus(builder.getNodes()[0].node_id, 'completed');
    expect(builder.isComplete()).toBe(true);
    expect(builder.hasFailed()).toBe(false);

    const builder2 = new OrchestrationGraphBuilder({
      execution_id: 'exec-2',
      account_id: 'acc-1',
      task_id: 'task-1',
      mode: 'single',
    });
    builder2.buildForMode('single');
    builder2.updateNodeStatus(builder2.getNodes()[0].node_id, 'failed');
    expect(builder2.hasFailed()).toBe(true);
  });

  it('toBuildResult returns serializable snapshot', () => {
    const builder = new OrchestrationGraphBuilder({
      execution_id: 'exec-1',
      account_id: 'acc-1',
      task_id: 'task-1',
      mode: 'single',
      limits: { max_nodes: 5, max_parallel: 2 },
    });
    builder.buildForMode('single');
    const result = builder.toBuildResult();
    expect(result.graph).toBeDefined();
    expect(result.nodes).toBeDefined();
    expect(result.graph.execution_id).toBe('exec-1');
    expect(result.nodes).toHaveLength(1);

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const serialized = JSON.parse(JSON.stringify(result)) as {
      graph: OrchestrationGraph;
      nodes: OrchestrationNode[];
    };
    expect(serialized.graph.execution_id).toBe('exec-1');
    expect(serialized.nodes[0].role).toBe('root');
  });
});

// ============================================================================
// Orchestration Orchestrator (in-memory, no store)
// ============================================================================

describe('OrchestrationOrchestrator', () => {
  let orchestrator: OrchestrationOrchestrator;

  beforeEach(() => {
    orchestrator = new OrchestrationOrchestrator();
  });

  it('creates graph (async createGraph)', async () => {
    const builder = await orchestrator.createGraph({
      execution_id: 'exec-1',
      account_id: 'acc-1',
      task_id: 'task-1',
      mode: 'single',
    });
    expect(builder.getGraph().graph_id).toBeDefined();
    expect(builder.getNodes()).toHaveLength(1);
  });

  it('executes single node graph (callback gets NodeExecutionContext)', async () => {
    const builder = await orchestrator.createGraph({
      execution_id: 'exec-1',
      account_id: 'acc-1',
      task_id: 'task-1',
      mode: 'single',
    });

    const receivedCtx: unknown[] = [];
    const result = await orchestrator.executeGraph(builder.getGraph().graph_id, async (ctx) => {
      receivedCtx.push(ctx);
      return { output: { result: 'ok' }, status: 'completed' as const };
    });

    expect(result.status).toBe('completed');
    expect(result.node_results).toHaveLength(1);
    expect(result.node_results[0].status).toBe('completed');
    expect(receivedCtx).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-unsafe-member-access
    const ctx0 = receivedCtx[0] as Record<string, unknown>;
    expect(ctx0.node_id).toBeDefined();
    expect(ctx0.role).toBe('root');
    expect(ctx0.parent_node_id).toBeNull();
    expect(ctx0.graph_id).toBe(builder.getGraph().graph_id);
    expect(ctx0.graph_mode).toBe('single');
    expect(ctx0.limits).toBeDefined();
  });

  it('respects max_parallel limit (concurrentCount never exceeds max_parallel)', async () => {
    const max_parallel = 2;
    const builder = await orchestrator.createGraph({
      execution_id: 'exec-1',
      account_id: 'acc-1',
      task_id: 'task-1',
      mode: 'parallel_candidates',
      limits: { max_parallel },
    });

    let concurrentCount = 0;
    let maxConcurrent = 0;

    const result = await orchestrator.executeGraph(builder.getGraph().graph_id, async (ctx) => {
      concurrentCount++;
      maxConcurrent = Math.max(maxConcurrent, concurrentCount);
      await sleep(50);
      concurrentCount--;
      return { output: { role: ctx.role }, status: 'completed' as const };
    });

    expect(result.status).toBe('completed');
    expect(maxConcurrent).toBeLessThanOrEqual(max_parallel);
  });

  it('handles node failure', async () => {
    const builder = await orchestrator.createGraph({
      execution_id: 'exec-1',
      account_id: 'acc-1',
      task_id: 'task-1',
      mode: 'single',
    });

    const result = await orchestrator.executeGraph(builder.getGraph().graph_id, async () => ({
      output: undefined,
      status: 'failed' as const,
    }));

    expect(result.status).toBe('partial');
    expect(result.node_results[0].status).toBe('failed');
  });

  it('cancels graph correctly (graph.status should be cancelled)', async () => {
    const builder = await orchestrator.createGraph({
      execution_id: 'exec-1',
      account_id: 'acc-1',
      task_id: 'task-1',
      mode: 'parallel_candidates',
    });

    const graphId = builder.getGraph().graph_id;
    await orchestrator.cancelGraph(graphId);

    const graph = builder.getGraph();
    expect(graph.status).toBe('cancelled');
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

// ============================================================================
// Orchestration Orchestrator with store
// ============================================================================

describe('OrchestrationOrchestrator with store', () => {
  let store: OrchestratorStore;
  let graphs: Map<string, OrchestrationGraph>;
  let nodes: Map<string, OrchestrationNode>;

  beforeEach(() => {
    graphs = new Map();
    nodes = new Map();
    store = {
      saveGraph: vi.fn(async (g: OrchestrationGraph) => {
        graphs.set(g.graph_id, g);
      }),
      saveNodes: vi.fn(async (ns: OrchestrationNode[]) => {
        for (const n of ns) nodes.set(n.node_id, n);
      }),
      updateGraphNode: vi.fn(async (graphId: string, status: OrchestrationGraph['status']) => {
        const g = graphs.get(graphId);
        if (g) g.status = status;
      }),
      updateNode: vi.fn(async (nodeId: string, status: OrchestrationNode['status']) => {
        const n = nodes.get(nodeId);
        if (n) n.status = status;
      }),
      getGraph: vi.fn(async (graphId: string) => graphs.get(graphId) ?? null),
      getNodesByGraph: vi.fn(async (graphId: string) =>
        [...nodes.values()].filter((n) => n.graph_id === graphId)
      ),
      getGraphByExecution: vi.fn(async () => null),
    };
  });

  it('persists graph via store', async () => {
    const orchestrator = new OrchestrationOrchestrator(store);
    await orchestrator.createGraph({
      execution_id: 'exec-1',
      account_id: 'acc-1',
      task_id: 'task-1',
      mode: 'single',
    });

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(store.saveGraph).toHaveBeenCalledOnce();
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(store.saveNodes).toHaveBeenCalledOnce();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-unsafe-member-access
    const savedGraph = (store.saveGraph as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as OrchestrationGraph;
    expect(savedGraph.execution_id).toBe('exec-1');
    expect(graphs.has(savedGraph.graph_id)).toBe(true);

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-unsafe-member-access
    const savedNodes = (store.saveNodes as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as OrchestrationNode[];
    expect(savedNodes).toHaveLength(1);
    expect(savedNodes[0].role).toBe('root');
  });

  it('deduplicates on same execution_id', async () => {
    const orchestrator = new OrchestrationOrchestrator(store);

    const builder1 = await orchestrator.createGraph({
      execution_id: 'exec-dedup',
      account_id: 'acc-1',
      task_id: 'task-1',
      mode: 'single',
    });

    const graphId = builder1.getGraph().graph_id;
    const existingGraph = graphs.get(graphId)!;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    (store.getGraphByExecution as ReturnType<typeof vi.fn>).mockResolvedValueOnce(existingGraph);

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment,@typescript-eslint/unbound-method
    const callCountBefore = (store.saveGraph as ReturnType<typeof vi.fn>).mock.calls.length;

    await orchestrator.createGraph({
      execution_id: 'exec-dedup',
      account_id: 'acc-1',
      task_id: 'task-1',
      mode: 'single',
    });

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(store.getGraphByExecution).toHaveBeenCalledWith('exec-dedup');
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect((store.saveGraph as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callCountBefore);

    const result = await orchestrator.executeGraph(graphId, async () => ({
      output: { deduped: true },
      status: 'completed' as const,
    }));
    expect(result.status).toBe('completed');
  });

  it('survives reconstruction (create new orchestrator with same store, execute same graph)', async () => {
    const orchestrator1 = new OrchestrationOrchestrator(store);
    const builder = await orchestrator1.createGraph({
      execution_id: 'exec-rebuild',
      account_id: 'acc-1',
      task_id: 'task-1',
      mode: 'single',
    });
    const graphId = builder.getGraph().graph_id;

    const orchestrator2 = new OrchestrationOrchestrator(store);

    (store.getGraphByExecution as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      graphs.get(graphId)
    );
    await orchestrator2.createGraph({
      execution_id: 'exec-rebuild',
      account_id: 'acc-1',
      task_id: 'task-1',
      mode: 'single',
    });

    const result = await orchestrator2.executeGraph(graphId, async () => ({
      output: { rebuilt: true },
      status: 'completed' as const,
    }));

    expect(result.status).toBe('completed');
    expect(result.execution_id).toBe('exec-rebuild');
  });
});
