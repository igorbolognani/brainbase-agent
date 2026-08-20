import { once } from 'node:events';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGPTRouterHttpRuntime, type GPTRouterHttpRuntime } from '../http-app.js';
import type { HttpServerConfig } from '../http-config.js';
import { GPTRouterDashboardResourceUri } from '../plugin-ui.js';

const TOKEN = '0123456789abcdef0123456789abcdef';

interface HttpResult {
  status: number;
  body: string;
  headers: Record<string, string | string[] | undefined>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: string | number | null;
  result?: unknown;
  error?: unknown;
}

function remoteConfig(): HttpServerConfig {
  return {
    mode: 'remote',
    host: '127.0.0.1',
    port: 0,
    allowedHosts: ['api.example.com'],
    allowedOrigins: ['https://chatgpt.com'],
    bearerToken: TOKEN,
  };
}

function parseRpcBody(body: string): JsonRpcResponse {
  const trimmed = body.trim();
  if (trimmed.startsWith('{')) return JSON.parse(trimmed) as JsonRpcResponse;

  const dataLines = trimmed
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).trim());

  if (dataLines.length === 0) {
    throw new Error(`Expected JSON or SSE data frame, got: ${trimmed.slice(0, 200)}`);
  }
  return JSON.parse(dataLines.at(-1)!) as JsonRpcResponse;
}

function post(
  port: number,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<HttpResult> {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/mcp',
        method: 'POST',
        headers: {
          host: 'api.example.com',
          origin: 'https://chatgpt.com',
          authorization: `Bearer ${TOKEN}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'content-length': String(Buffer.byteLength(payload)),
          ...headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
            headers: res.headers,
          });
        });
      }
    );
    req.on('error', reject);
    req.end(payload);
  });
}

async function listen(runtime: GPTRouterHttpRuntime): Promise<number> {
  runtime.server.listen(0, '127.0.0.1');
  await once(runtime.server, 'listening');
  return (runtime.server.address() as AddressInfo).port;
}

describe('MCP Streamable HTTP boundary', () => {
  let runtime: GPTRouterHttpRuntime;
  let port: number;

  beforeEach(async () => {
    runtime = createGPTRouterHttpRuntime(remoteConfig());
    port = await listen(runtime);
  });

  afterEach(async () => {
    await runtime.close();
  });

  it('rejects a disallowed Host before MCP dispatch', async () => {
    const result = await post(
      port,
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      { host: 'evil.example.com' }
    );
    expect(result.status).toBe(403);
    expect(JSON.parse(result.body)).toEqual({ error: 'forbidden_host' });
  });

  it('rejects a disallowed Origin before MCP dispatch', async () => {
    const result = await post(
      port,
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      { origin: 'https://evil.example.com' }
    );
    expect(result.status).toBe(403);
    expect(JSON.parse(result.body)).toEqual({ error: 'forbidden_origin' });
  });

  it('requires bearer authentication before MCP dispatch', async () => {
    const result = await post(
      port,
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      { authorization: 'Bearer wrong' }
    );
    expect(result.status).toBe(401);
    expect(result.headers['www-authenticate']).toBe('Bearer realm="gptrouter-mcp"');
    expect(JSON.parse(result.body)).toEqual({ error: 'invalid_token' });
  });

  it('initializes through the real HTTP transport', async () => {
    const result = await post(port, {
      jsonrpc: '2.0',
      id: 'init-1',
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'gptrouter-test-client', version: '1.0.0' },
      },
    });

    expect(result.status).toBe(200);
    const rpc = parseRpcBody(result.body);
    expect(rpc.error).toBeUndefined();
    expect(rpc.result).toBeTruthy();
  });

  it('lists the safe V0.1 tools over real HTTP', async () => {
    const result = await post(port, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
    expect(result.status).toBe(200);
    const rpc = parseRpcBody(result.body);
    expect(rpc.error).toBeUndefined();

    const tools = (rpc.result as { tools: Array<{ name: string }> }).tools.map((tool) => tool.name);
    expect(tools).toEqual([
      'list_models',
      'route_task',
      'get_task',
      'get_usage',
      'render_gptrouter_dashboard',
    ]);
    expect(tools).not.toContain('run_task');
  });

  it('exposes the GPTRouter MCP Apps resource over real HTTP', async () => {
    const listResult = await post(port, { jsonrpc: '2.0', id: 4, method: 'resources/list' });
    expect(listResult.status).toBe(200);
    const listed = parseRpcBody(listResult.body);
    expect(listed.error).toBeUndefined();
    expect(
      (listed.result as { resources: Array<{ uri: string }> }).resources.map(
        (resource) => resource.uri
      )
    ).toContain(GPTRouterDashboardResourceUri);

    const readResult = await post(port, {
      jsonrpc: '2.0',
      id: 5,
      method: 'resources/read',
      params: { uri: GPTRouterDashboardResourceUri },
    });
    expect(readResult.status).toBe(200);
    const read = parseRpcBody(readResult.body);
    expect(read.error).toBeUndefined();
    const resource = (
      read.result as {
        contents: Array<{ uri: string; mimeType: string; text: string }>;
      }
    ).contents[0];
    expect(resource.uri).toBe(GPTRouterDashboardResourceUri);
    expect(resource.mimeType).toBe('text/html;profile=mcp-app');
    expect(resource.text).toContain('Synthetic / no-spend');
  });

  it('renders the dashboard as structured synthetic no-spend state', async () => {
    const result = await post(port, {
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: {
        name: 'render_gptrouter_dashboard',
        arguments: { active_page: 'router' },
      },
    });

    expect(result.status).toBe(200);
    const rpc = parseRpcBody(result.body);
    expect(rpc.error).toBeUndefined();
    const structured = (
      rpc.result as {
        structuredContent: {
          active_page: string;
          data_mode: string;
          safety: { provider_execution_enabled: boolean; paid_calls_enabled: boolean };
        };
      }
    ).structuredContent;
    expect(structured.active_page).toBe('router');
    expect(structured.data_mode).toBe('synthetic_repository');
    expect(structured.safety.provider_execution_enabled).toBe(false);
    expect(structured.safety.paid_calls_enabled).toBe(false);
  });

  it('calls route_task over HTTP and proves the slice remains planning-only', async () => {
    const result = await post(port, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'route_task',
        arguments: {
          description: 'Synthetic transport verification only',
          required_capabilities: ['text'],
          ordering_strategy: 'cost',
        },
      },
    });

    expect(result.status).toBe(200);
    const rpc = parseRpcBody(result.body);
    expect(rpc.error).toBeUndefined();
    const content = (rpc.result as { content: Array<{ type: string; text: string }> }).content;
    const decision = JSON.parse(content[0].text) as {
      status: string;
      estimated_cost: number;
      note: string;
    };

    expect(decision.status).toBe('planning');
    expect(decision.estimated_cost).toBeGreaterThanOrEqual(0);
    expect(decision.note).toContain('No provider execution or spending occurs');
  });

  it('runs the full Phase 0G repository-backed vertical slice over real HTTP', async () => {
    const listResult = await post(port, {
      jsonrpc: '2.0',
      id: 'slice-list',
      method: 'tools/call',
      params: { name: 'list_models', arguments: {} },
    });
    expect(listResult.status).toBe(200);
    const listRpc = parseRpcBody(listResult.body);
    expect(listRpc.error).toBeUndefined();
    const listContent = (listRpc.result as { content: Array<{ type: string; text: string }> })
      .content;
    const listOutput = JSON.parse(listContent[0].text) as {
      data_mode: string;
      account_id: string;
      models: Array<{
        route_id: string;
        source_id: string;
        source_provider: string;
        provenance: string;
        pricing: { source: string };
        capabilities: string[];
      }>;
    };
    expect(listOutput.data_mode).toBe('synthetic_repository');
    expect(listOutput.account_id).toBe('account-synthetic-v0');
    expect(listOutput.models).toHaveLength(2);
    expect(listOutput.models.every((model) => model.provenance === 'synthetic_repository')).toBe(
      true
    );
    expect(listOutput.models.every((model) => model.source_id.startsWith('synthetic-'))).toBe(true);
    expect(listOutput.models.some((model) => model.route_id === 'route-synthetic-text-free')).toBe(
      true
    );

    const planResult = await post(port, {
      jsonrpc: '2.0',
      id: 'slice-plan',
      method: 'tools/call',
      params: {
        name: 'route_task',
        arguments: {
          description: 'Phase 0G vertical slice task',
          required_capabilities: ['text', 'vision'],
          ordering_strategy: 'cost',
        },
      },
    });
    expect(planResult.status).toBe(200);
    const planRpc = parseRpcBody(planResult.body);
    expect(planRpc.error).toBeUndefined();
    const planContent = (planRpc.result as { content: Array<{ type: string; text: string }> })
      .content;
    const plan = JSON.parse(planContent[0].text) as {
      task_id: string;
      decision_id: string;
      status: string;
      data_mode: string;
      actual_cost: number;
      estimated_cost: number;
      selected_route: { route_id: string } | null;
      note: string;
    };
    expect(plan.status).toBe('planning');
    expect(plan.data_mode).toBe('synthetic_repository');
    expect(plan.actual_cost).toBe(0);
    expect(plan.estimated_cost).toBeGreaterThan(0);
    expect(plan.selected_route?.route_id).toBe('route-synthetic-multimodal-cheap');
    expect(plan.note).toContain('No provider execution or spending occurs');

    const getResult = await post(port, {
      jsonrpc: '2.0',
      id: 'slice-get',
      method: 'tools/call',
      params: { name: 'get_task', arguments: { task_id: plan.task_id } },
    });
    expect(getResult.status).toBe(200);
    const getRpc = parseRpcBody(getResult.body);
    expect(getRpc.error).toBeUndefined();
    const getContent = (getRpc.result as { content: Array<{ type: string; text: string }> })
      .content;
    const task = JSON.parse(getContent[0].text) as {
      task: { task_id: string; account_id: string; description: string; status: string };
      latest_decision: {
        decision_id: string;
        selected_route_id: string | null;
        estimated_cost: number | null;
      };
      actual_cost: number;
      execution_status: string;
      data_mode: string;
    };
    expect(task.task.task_id).toBe(plan.task_id);
    expect(task.task.account_id).toBe('account-synthetic-v0');
    expect(task.task.status).toBe('planning');
    expect(task.latest_decision.decision_id).toBe(plan.decision_id);
    expect(task.latest_decision.selected_route_id).toBe(plan.selected_route?.route_id ?? null);
    expect(task.actual_cost).toBe(0);
    expect(task.execution_status).toBe('not_started');
    expect(task.data_mode).toBe('synthetic_repository');

    const usageResult = await post(port, {
      jsonrpc: '2.0',
      id: 'slice-usage',
      method: 'tools/call',
      params: { name: 'get_usage', arguments: { time_range: 'today' } },
    });
    expect(usageResult.status).toBe(200);
    const usageRpc = parseRpcBody(usageResult.body);
    expect(usageRpc.error).toBeUndefined();
    const usageContent = (usageRpc.result as { content: Array<{ type: string; text: string }> })
      .content;
    const usage = JSON.parse(usageContent[0].text) as {
      planning_requests: number;
      execution_requests: number;
      actual_cost: number;
      estimated_planned_cost: number;
      actual_usage_records: number;
      data_mode: string;
    };
    expect(usage.planning_requests).toBe(1);
    expect(usage.execution_requests).toBe(0);
    expect(usage.actual_usage_records).toBe(0);
    expect(usage.actual_cost).toBe(0);
    expect(usage.estimated_planned_cost).toBeCloseTo(plan.estimated_cost, 6);
    expect(usage.data_mode).toBe('synthetic_repository');

    const dashResult = await post(port, {
      jsonrpc: '2.0',
      id: 'slice-dash',
      method: 'tools/call',
      params: { name: 'render_gptrouter_dashboard', arguments: { active_page: 'tasks' } },
    });
    expect(dashResult.status).toBe(200);
    const dashRpc = parseRpcBody(dashResult.body);
    expect(dashRpc.error).toBeUndefined();
    const dashboard = (
      dashRpc.result as {
        structuredContent: {
          data_mode: string;
          active_page: string;
          runtime: {
            route_count: number;
            task_count: number;
            decision_count: number;
            execution_count: number;
            actual_spend: number;
            estimated_planned_cost: number;
          };
          safety: { provider_execution_enabled: boolean; paid_calls_enabled: boolean };
        };
      }
    ).structuredContent;
    expect(dashboard.data_mode).toBe('synthetic_repository');
    expect(dashboard.active_page).toBe('tasks');
    expect(dashboard.runtime.route_count).toBe(2);
    expect(dashboard.runtime.task_count).toBe(1);
    expect(dashboard.runtime.decision_count).toBe(1);
    expect(dashboard.runtime.execution_count).toBe(0);
    expect(dashboard.runtime.actual_spend).toBe(0);
    expect(dashboard.runtime.estimated_planned_cost).toBeCloseTo(plan.estimated_cost, 6);
    expect(dashboard.safety.provider_execution_enabled).toBe(false);
    expect(dashboard.safety.paid_calls_enabled).toBe(false);

    const allOutputs = [
      listResult.body,
      planResult.body,
      getResult.body,
      usageResult.body,
      dashResult.body,
    ].join(' ');
    expect(allOutputs).not.toContain('opaque-synthetic-reference');
    expect(allOutputs).not.toContain('credential_reference');

    const toolsResult = await post(port, {
      jsonrpc: '2.0',
      id: 'slice-tools',
      method: 'tools/list',
    });
    expect(toolsResult.status).toBe(200);
    const toolsRpc = parseRpcBody(toolsResult.body);
    const toolNames = (toolsRpc.result as { tools: Array<{ name: string }> }).tools.map(
      (tool) => tool.name
    );
    expect(toolNames).not.toContain('run_task');
    expect(toolNames).toContain('list_models');
    expect(toolNames).toContain('route_task');
    expect(toolNames).toContain('get_task');
    expect(toolNames).toContain('get_usage');
  });
});
