import { OrchestrationGraphBuilder, type CreateGraphInput } from './orchestration-graph.js';

export type OrchestratorResult = {
  graph_id: string;
  execution_id: string;
  status: 'completed' | 'failed' | 'cancelled';
  node_results: Array<{
    node_id: string;
    role: string;
    status: string;
    output?: unknown;
  }>;
};

export type ExecuteNodeFn = (
  nodeId: string,
  role: string,
  parentId?: string
) => Promise<{ output: unknown; status: 'completed' | 'failed' }>;

export class OrchestrationOrchestrator {
  private builders = new Map<string, OrchestrationGraphBuilder>();

  createGraph(input: CreateGraphInput): OrchestrationGraphBuilder {
    const builder = new OrchestrationGraphBuilder(input);
    builder.buildForMode(input.mode);
    this.builders.set(builder.getGraph().graph_id, builder);
    return builder;
  }

  async executeGraph(graphId: string, executeNode: ExecuteNodeFn): Promise<OrchestratorResult> {
    const builder = this.builders.get(graphId);
    if (!builder) throw new Error(`Graph ${graphId} not found`);

    const graph = builder.getGraph();
    const results: OrchestratorResult['node_results'] = [];

    try {
      while (!builder.isComplete()) {
        const runnable = builder.getRunnableNodes();
        if (runnable.length === 0 && builder.getPendingNodes().length > 0) {
          break;
        }
        if (runnable.length === 0) break;

        builder
          .getNodes()
          .filter((n) => n.status === 'pending')
          .forEach((n) => {
            const parent = builder.getNodes().find((p) => p.node_id === n.parent_node_id);
            if (parent?.status === 'completed' || !n.parent_node_id) {
              if (n.status === 'pending') {
                builder.updateNodeStatus(n.node_id, 'running');
              }
            }
          });

        const runningBatch = builder.getNodes().filter((n) => n.status === 'running');
        const batchResults = await Promise.allSettled(
          runningBatch.map(async (node) => {
            const result = await executeNode(
              node.node_id,
              node.role,
              node.parent_node_id ?? undefined
            );
            builder.updateNodeStatus(node.node_id, result.status);
            return { node_id: node.node_id, role: node.role, ...result };
          })
        );

        for (const r of batchResults) {
          if (r.status === 'fulfilled') {
            results.push({
              node_id: r.value.node_id,
              role: r.value.role,
              status: r.value.status,
              output: r.value.output,
            });
          } else {
            results.push({
              node_id: 'unknown',
              role: 'unknown',
              status: 'failed',
            });
          }
        }

        if (builder.hasFailed()) {
          builder.markFailed();
          break;
        }
      }

      if (builder.isComplete() && !builder.hasFailed()) {
        builder.markComplete();
      }
    } catch {
      builder.markFailed();
    }

    const finalGraph = builder.getGraph();
    return {
      graph_id: graphId,
      execution_id: graph.execution_id,
      status: finalGraph.status as OrchestratorResult['status'],
      node_results: results,
    };
  }

  cancelGraph(graphId: string): void {
    const builder = this.builders.get(graphId);
    if (!builder) return;
    builder
      .getNodes()
      .filter((n) => n.status === 'pending' || n.status === 'running')
      .forEach((n) => builder.updateNodeStatus(n.node_id, 'cancelled'));
    builder.markFailed();
  }
}
