import type {
  OrchestrationGraph,
  OrchestrationNode,
  OrchestrationGraphStatus,
} from '@gptrouter/contracts';
import { OrchestrationGraphBuilder, type CreateGraphInput } from './orchestration-graph.js';

export type OrchestratorResult = {
  graph_id: string;
  execution_id: string;
  status: OrchestrationGraphStatus;
  node_results: Array<{
    node_id: string;
    role: string;
    status: string;
    output?: unknown;
    decision_id?: string;
    execution_id?: string;
  }>;
};

export type NodeExecutionContext = {
  node_id: string;
  role: string;
  parent_node_id: string | null;
  graph_id: string;
  graph_mode: string;
  limits: {
    node_timeout_ms: number;
    max_retries_per_node: number;
  };
};

export type NodeExecutionResult = {
  output: unknown;
  status: 'completed' | 'failed';
  decision_id?: string;
  execution_id?: string;
};

export type ExecuteNodeFn = (ctx: NodeExecutionContext) => Promise<NodeExecutionResult>;

export type OrchestratorStore = {
  saveGraph(graph: OrchestrationGraph): Promise<void>;
  saveNodes(nodes: OrchestrationNode[]): Promise<void>;
  updateGraphNode(graphId: string, status: OrchestrationGraphStatus): Promise<void>;
  updateNode(nodeId: string, status: OrchestrationNode['status']): Promise<void>;
  getGraph(graphId: string): Promise<OrchestrationGraph | null>;
  getNodesByGraph(graphId: string): Promise<OrchestrationNode[]>;
  getGraphByExecution(executionId: string): Promise<OrchestrationGraph | null>;
};

export class OrchestrationOrchestrator {
  private builders = new Map<string, OrchestrationGraphBuilder>();
  private cancelRequested = new Set<string>();

  constructor(private readonly store?: OrchestratorStore) {}

  async createGraph(input: CreateGraphInput): Promise<OrchestrationGraphBuilder> {
    if (this.store) {
      const existing = await this.store.getGraphByExecution(input.execution_id);
      if (existing) {
        const builder = new OrchestrationGraphBuilder({
          execution_id: existing.execution_id,
          account_id: existing.account_id,
          task_id: existing.task_id,
          mode: existing.mode,
          limits: existing.limits,
        });
        this.builders.set(existing.graph_id, builder);
        return builder;
      }
    }

    const builder = new OrchestrationGraphBuilder(input);
    builder.buildForMode(input.mode);
    this.builders.set(builder.getGraph().graph_id, builder);

    if (this.store) {
      await this.store.saveGraph(builder.getGraph());
      await this.store.saveNodes(builder.getNodes());
    }

    return builder;
  }

  async executeGraph(graphId: string, executeNode: ExecuteNodeFn): Promise<OrchestratorResult> {
    const builder = this.builders.get(graphId);
    if (!builder) throw new Error(`Graph ${graphId} not found`);

    const graph = builder.getGraph();
    const results: OrchestratorResult['node_results'] = [];
    this.cancelRequested.delete(graphId);

    try {
      builder.updateGraphStatus('running');
      if (this.store) {
        await this.store.updateGraphNode(graphId, 'running');
      }

      while (!builder.isComplete() && !this.cancelRequested.has(graphId)) {
        const runnable = builder.getRunnableNodes();
        if (runnable.length === 0) {
          const hasActive = builder
            .getNodes()
            .some((n) => n.status === 'running' || n.status === 'retrying');
          if (!hasActive && builder.getPendingNodes().length > 0) break;
          if (!hasActive) break;
          await sleep(10);
          continue;
        }

        const availableSlots = builder.getParallelSlots();
        const toExecute = runnable.slice(0, Math.max(0, availableSlots));

        for (const node of toExecute) {
          builder.updateNodeStatus(node.node_id, 'running');
          if (this.store) {
            await this.store.updateNode(node.node_id, 'running');
          }
        }

        const batchResults = await Promise.allSettled(
          toExecute.map(async (node) => {
            const ctx: NodeExecutionContext = {
              node_id: node.node_id,
              role: node.role,
              parent_node_id: node.parent_node_id,
              graph_id: graphId,
              graph_mode: graph.mode,
              limits: {
                node_timeout_ms: graph.limits.node_timeout_ms,
                max_retries_per_node: graph.limits.max_retries_per_node,
              },
            };
            const result = await executeNode(ctx);
            builder.updateNodeStatus(node.node_id, result.status);
            if (this.store) {
              await this.store.updateNode(node.node_id, result.status);
            }
            return {
              node_id: node.node_id,
              role: node.role,
              status: result.status,
              output: result.output,
              decision_id: result.decision_id,
              execution_id: result.execution_id,
            };
          })
        );

        for (const r of batchResults) {
          if (r.status === 'fulfilled') {
            results.push(r.value);
          } else {
            results.push({
              node_id: 'unknown',
              role: 'unknown',
              status: 'failed',
            });
          }
        }

        if (builder.hasFailed()) {
          const hasRunnable = builder.getRunnableNodes().length > 0;
          const hasPending = builder.getPendingNodes().length > 0;
          if (!hasRunnable && !hasPending) {
            builder.updateGraphStatus('failed');
            if (this.store) {
              await this.store.updateGraphNode(graphId, 'failed');
            }
            break;
          }
        }
      }

      if (this.cancelRequested.has(graphId)) {
        for (const node of builder.getNodes()) {
          if (node.status === 'pending') {
            builder.updateNodeStatus(node.node_id, 'cancelled');
            if (this.store) {
              await this.store.updateNode(node.node_id, 'cancelled');
            }
          }
        }
        const allCancelled = builder
          .getNodes()
          .every(
            (n) => n.status === 'cancelled' || n.status === 'completed' || n.status === 'skipped'
          );
        const finalStatus: OrchestrationGraphStatus = allCancelled ? 'cancelled' : 'partial';
        builder.updateGraphStatus(finalStatus);
        if (this.store) {
          await this.store.updateGraphNode(graphId, finalStatus);
        }
      } else if (builder.isComplete()) {
        const hasFailed = builder.hasFailed();
        const finalStatus: OrchestrationGraphStatus = hasFailed ? 'partial' : 'completed';
        builder.updateGraphStatus(finalStatus);
        if (this.store) {
          await this.store.updateGraphNode(graphId, finalStatus);
        }
      }
    } catch {
      builder.updateGraphStatus('failed');
      if (this.store) {
        await this.store.updateGraphNode(graphId, 'failed');
      }
    }

    const finalGraph = builder.getGraph();
    return {
      graph_id: graphId,
      execution_id: finalGraph.execution_id,
      status: finalGraph.status,
      node_results: results,
    };
  }

  requestCancel(graphId: string): void {
    this.cancelRequested.add(graphId);
  }

  async cancelGraph(graphId: string): Promise<void> {
    const builder = this.builders.get(graphId);
    if (!builder) return;

    this.cancelRequested.add(graphId);

    for (const node of builder.getNodes()) {
      if (node.status === 'pending') {
        builder.updateNodeStatus(node.node_id, 'cancelled');
        if (this.store) {
          await this.store.updateNode(node.node_id, 'cancelled');
        }
      }
    }

    const allCancelled = builder
      .getNodes()
      .every((n) => n.status === 'cancelled' || n.status === 'completed' || n.status === 'skipped');
    const finalStatus: OrchestrationGraphStatus = allCancelled ? 'cancelled' : 'partial';
    builder.updateGraphStatus(finalStatus);
    if (this.store) {
      await this.store.updateGraphNode(graphId, finalStatus);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
