import type {
  OrchestrationGraph,
  OrchestrationNode,
  OrchestrationMode,
  OrchestrationNodeRole,
  OrchestrationGraphStatus,
  OrchestrationLimits,
} from '@gptrouter/contracts';
import { DEFAULT_ORCHESTRATION_LIMITS } from '@gptrouter/contracts';

export type CreateGraphInput = {
  execution_id: string;
  account_id: string;
  task_id: string;
  mode: OrchestrationMode;
  limits?: Partial<OrchestrationLimits>;
};

export type AddNodeInput = {
  parent_node_id?: string;
  role: OrchestrationNodeRole;
  execution_id?: string;
  decision_id?: string;
};

export type BuildResult = {
  graph: OrchestrationGraph;
  nodes: OrchestrationNode[];
};

export class OrchestrationGraphBuilder {
  private graph: OrchestrationGraph;
  private nodes: OrchestrationNode[] = [];

  constructor(input: CreateGraphInput) {
    const limits: OrchestrationLimits = {
      ...DEFAULT_ORCHESTRATION_LIMITS,
      ...input.limits,
    };
    this.graph = {
      graph_id: `graph-${randomId()}`,
      execution_id: input.execution_id,
      account_id: input.account_id,
      task_id: input.task_id,
      mode: input.mode,
      status: 'pending',
      limits,
      created_at: new Date(),
      updated_at: new Date(),
    };
  }

  getGraph(): OrchestrationGraph {
    return { ...this.graph };
  }

  getNodes(): OrchestrationNode[] {
    return this.nodes.map((n) => ({ ...n }));
  }

  buildForMode(mode: OrchestrationMode): this {
    switch (mode) {
      case 'single':
        this.addNode({ role: 'root' });
        break;
      case 'fallback':
        this.addNode({ role: 'root' });
        this.addNode({ role: 'worker', parent_node_id: this.nodes[0].node_id });
        break;
      case 'parallel_candidates':
        this.addNode({ role: 'root' });
        for (let i = 0; i < 3; i++) {
          this.addNode({ role: 'candidate', parent_node_id: this.nodes[0].node_id });
        }
        break;
      case 'planner_worker_reviewer':
        this.addNode({ role: 'root' });
        this.addNode({ role: 'planner', parent_node_id: this.nodes[0].node_id });
        this.addNode({ role: 'worker', parent_node_id: this.nodes[1].node_id });
        this.addNode({ role: 'reviewer', parent_node_id: this.nodes[2].node_id });
        break;
    }
    return this;
  }

  addNode(input: AddNodeInput): OrchestrationNode {
    if (this.nodes.length >= this.graph.limits.max_nodes) {
      throw new Error(`Node limit ${this.graph.limits.max_nodes} reached`);
    }

    const sort_order = input.parent_node_id
      ? this.nodes.filter((n) => n.parent_node_id === input.parent_node_id).length
      : 0;

    const node: OrchestrationNode = {
      node_id: `node-${randomId()}`,
      graph_id: this.graph.graph_id,
      parent_node_id: input.parent_node_id ?? null,
      role: input.role,
      execution_id: input.execution_id ?? null,
      decision_id: input.decision_id ?? null,
      status: 'pending',
      sort_order,
      created_at: new Date(),
      updated_at: new Date(),
    };

    this.nodes.push(node);
    return node;
  }

  getNodeById(nodeId: string): OrchestrationNode | undefined {
    return this.nodes.find((n) => n.node_id === nodeId);
  }

  getChildNodes(parentNodeId: string): OrchestrationNode[] {
    return this.nodes.filter((n) => n.parent_node_id === parentNodeId);
  }

  getPendingNodes(): OrchestrationNode[] {
    return this.nodes.filter((n) => n.status === 'pending');
  }

  getRunnableNodes(): OrchestrationNode[] {
    return this.nodes.filter((n) => {
      if (n.status !== 'pending') return false;
      if (!n.parent_node_id) return true;
      const parent = this.nodes.find((p) => p.node_id === n.parent_node_id);
      return parent?.status === 'completed';
    });
  }

  updateNodeStatus(nodeId: string, status: OrchestrationNode['status']): void {
    const node = this.nodes.find((n) => n.node_id === nodeId);
    if (!node) throw new Error(`Node ${nodeId} not found`);
    node.status = status;
    node.updated_at = new Date();
    this.graph.updated_at = new Date();
  }

  updateGraphStatus(status: OrchestrationGraphStatus): void {
    this.graph.status = status;
    this.graph.updated_at = new Date();
  }

  getParallelSlots(): number {
    const running = this.nodes.filter((n) => n.status === 'running').length;
    return Math.max(0, this.graph.limits.max_parallel - running);
  }

  isComplete(): boolean {
    return this.nodes.every(
      (n) =>
        n.status === 'completed' ||
        n.status === 'failed' ||
        n.status === 'cancelled' ||
        n.status === 'skipped'
    );
  }

  hasFailed(): boolean {
    return this.nodes.some((n) => n.status === 'failed');
  }

  hasActiveNodes(): boolean {
    return this.nodes.some((n) => n.status === 'running' || n.status === 'retrying');
  }

  getStageCount(): number {
    const completed = this.nodes.filter((n) => n.status === 'completed');
    return completed.length;
  }

  toBuildResult(): BuildResult {
    return {
      graph: { ...this.graph },
      nodes: this.nodes.map((n) => ({ ...n })),
    };
  }
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 10);
}
