import { once } from 'node:events';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGPTRouterHttpRuntime, type GPTRouterHttpRuntime } from '../http-app.js';
import type { HttpServerConfig } from '../http-config.js';

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
    expect(tools).toEqual(['list_models', 'route_task', 'get_task', 'get_usage']);
    expect(tools).not.toContain('run_task');
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
    expect(decision.note).toContain('No execution or spending occurs');
  });
});
