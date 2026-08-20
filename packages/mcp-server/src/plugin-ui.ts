import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { DashboardRuntimeSummary } from './application.js';
import type { McpToolContext } from './handlers.js';

export const GPTRouterDashboardResourceUri = 'ui://gptrouter/dashboard-v1.html';
export const GPTRouterMcpAppsProtocolVersion = '2026-01-26';

export const GPTRouterDashboardPageIds = [
  'overview',
  'router',
  'tasks',
  'engineering',
  'models',
  'providers_connections',
  'gateways_proxies',
  'usage_budgets',
  'security_permissions',
  'activity_audit',
  'settings',
] as const;

export type GPTRouterDashboardPageId = (typeof GPTRouterDashboardPageIds)[number];

type PageStatus = 'functional_shell' | 'placeholder';

interface PageDefinition {
  label: string;
  eyebrow: string;
  summary: string;
  items: string[];
  status: PageStatus;
}

const pageDefinitions: Record<GPTRouterDashboardPageId, PageDefinition> = {
  overview: {
    label: 'Overview',
    eyebrow: 'CONTROL SURFACE',
    status: 'functional_shell',
    summary:
      'GPTRouter repository-backed synthetic control surface. Provider execution remains disabled.',
    items: [
      'Routing mode: lowest-cost adequate capability',
      'Execution: deterministic synthetic executor enabled',
      'Provider execution: disabled',
      'Remote MCP: available behind configured security boundaries',
      'Data source: authoritative synthetic repository state',
      'Retry/fallback/cancellation: implemented and audited',
    ],
  },
  router: {
    label: 'Router',
    eyebrow: 'PLANNING ONLY',
    status: 'functional_shell',
    summary:
      'Routing decisions use the real RoutingEngine over repository-backed synthetic routes.',
    items: [
      'Cost ordering is operational',
      'Quality, latency, and custom ordering fail closed',
      'Gateway HTTPS policy resolves persisted connection metadata',
      'Manual overrides use the same admissibility path',
    ],
  },
  tasks: {
    label: 'Tasks',
    eyebrow: 'REPOSITORY STATE',
    status: 'functional_shell',
    summary:
      'Tasks, routing decisions, attempts, and synthetic execution state persist in the synthetic runtime repository.',
    items: [
      'run_task is explicit and idempotent',
      'Synthetic execution is deterministic and no-spend',
      'get_task reads the same state written by route_task',
      'Retry/fallback/cancellation provenance tracked per attempt',
      'execution_id stable across retry and fallback attempts',
    ],
  },
  engineering: {
    label: 'Engineering',
    eyebrow: 'ENGINEERING CONTROL PLANE',
    status: 'functional_shell',
    summary: 'Executor-agnostic status shell for implementation checkpoints and verification.',
    items: [
      'GitHub is the canonical source of code and CI evidence',
      'Development workers remain external to the product runtime',
      'No generic workflow-builder surface is introduced',
    ],
  },
  models: {
    label: 'Models',
    eyebrow: 'SYNTHETIC CATALOG',
    status: 'functional_shell',
    summary: 'The current model/route catalog is repository-backed and explicitly synthetic.',
    items: [
      'Synthetic route IDs replace production-looking fake model names',
      'Pricing provenance is synthetic-fixture',
      'No production model or pricing catalog is hardcoded into the domain layer',
    ],
  },
  providers_connections: {
    label: 'Providers & Connections',
    eyebrow: 'CONNECTION BOUNDARY',
    status: 'functional_shell',
    summary: 'Provider connections remain distinct from application identity.',
    items: [
      'OAuth and secure server-side secret setup remain supported patterns',
      'Raw credentials and vault references are never model-visible',
      'Runtime account authorization fails closed',
    ],
  },
  gateways_proxies: {
    label: 'Model Gateways / Proxies',
    eyebrow: 'SAFE GATEWAY BOUNDARY',
    status: 'functional_shell',
    summary: 'Gateway configuration is separate from direct provider connections.',
    items: [
      'HTTPS-only dispatch boundary',
      'DNS, IP, and redirect validation precede outbound gateway transport',
      'Private/local gateway bridge remains outside V0.1',
    ],
  },
  usage_budgets: {
    label: 'Usage & Budgets',
    eyebrow: 'NO-SPEND SESSION',
    status: 'functional_shell',
    summary:
      'Planning estimates are tracked separately from reconciled synthetic actual cost, which remains zero. Time-range filtering uses injected clock.',
    items: [
      'Estimated planned cost is not actual cost',
      'Synthetic execution actual cost: zero',
      'Provider execution and paid calls remain disabled',
      'Time filtering: today/week/month relative to server clock',
      'execution_roots tracks unique execution IDs separately from attempts',
    ],
  },
  security_permissions: {
    label: 'Security & Permissions',
    eyebrow: 'PLACEHOLDER',
    status: 'placeholder',
    summary:
      'Backend security exists; this page is not wired to authoritative production identity state yet.',
    items: [
      'OAuth resource-server boundary is implemented',
      'Tenant membership and role checks are implemented',
      'Secret-safe public serialization is implemented',
    ],
  },
  activity_audit: {
    label: 'Activity / Audit',
    eyebrow: 'SAFE PROJECTION',
    status: 'functional_shell',
    summary:
      'Account-scoped activity and audit events with sanitized metadata. No raw credential or secret material is exposed.',
    items: [
      'Bounded results with allowlisted fields only',
      'Metadata sanitized through safe-output boundary',
      'Secret-bearing arbitrary blobs never serialized',
      'Audit degradation visible when recording fails',
    ],
  },
  settings: {
    label: 'Settings',
    eyebrow: 'PLACEHOLDER',
    status: 'placeholder',
    summary: 'Account-level product settings are not persisted in a production database yet.',
    items: ['No control in this shell mutates production business state'],
  },
};

const emptyRuntimeSummary: DashboardRuntimeSummary = {
  data_source: 'synthetic_repository',
  route_count: 0,
  task_count: 0,
  decision_count: 0,
  execution_count: 0,
  successful_execution_count: 0,
  failed_attempt_count: 0,
  cancelled_attempt_count: 0,
  actual_spend: 0,
  estimated_planned_cost: 0,
  retry_count: 0,
  fallback_count: 0,
  audit_degraded: false,
  audit_failure_count: 0,
  synthetic_execution_enabled: true,
  provider_execution_enabled: false,
  paid_calls_enabled: false,
};

export interface GPTRouterDashboardSnapshot {
  schema_version: '1';
  product: 'GPTRouter';
  data_mode: 'synthetic_repository';
  active_page: GPTRouterDashboardPageId;
  navigation: Array<{ id: GPTRouterDashboardPageId; label: string; status: PageStatus }>;
  safety: {
    planning_only: false;
    synthetic_execution_enabled: true;
    provider_execution_enabled: false;
    paid_calls_enabled: false;
    fixture_data: true;
  };
  runtime: DashboardRuntimeSummary;
  pages: Record<GPTRouterDashboardPageId, PageDefinition>;
}

export function createGPTRouterDashboardSnapshot(
  activePage: GPTRouterDashboardPageId = 'overview',
  runtime: DashboardRuntimeSummary = emptyRuntimeSummary
): GPTRouterDashboardSnapshot {
  return {
    schema_version: '1',
    product: 'GPTRouter',
    data_mode: 'synthetic_repository',
    active_page: activePage,
    navigation: GPTRouterDashboardPageIds.map((id) => ({
      id,
      label: pageDefinitions[id].label,
      status: pageDefinitions[id].status,
    })),
    safety: {
      planning_only: false,
      synthetic_execution_enabled: true,
      provider_execution_enabled: false,
      paid_calls_enabled: false,
      fixture_data: true,
    },
    runtime: { ...runtime },
    pages: pageDefinitions,
  };
}

export const GPTRouterDashboardHtml = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>GPTRouter</title>
<style>
:root{color-scheme:light dark;font-family:Inter,ui-sans-serif,system-ui,sans-serif;--bg:#0f1115;--panel:#171a21;--panel2:#1f232c;--text:#f5f7fb;--muted:#9aa4b2;--line:#2b313d;--accent:#8bb8ff;--ok:#7fd6a7;--warn:#f1c97a}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text)}button{font:inherit}.app{min-height:420px;display:grid;grid-template-columns:minmax(180px,235px) minmax(0,1fr)}aside{border-right:1px solid var(--line);padding:16px 12px;background:var(--panel)}.brand{display:flex;justify-content:space-between;gap:8px;margin:0 4px 14px}.badge,.pill{border:1px solid var(--line);border-radius:999px;padding:4px 8px;font-size:11px;color:var(--warn);white-space:nowrap}nav{display:grid;gap:4px}.nav{border:0;border-radius:8px;padding:9px 10px;text-align:left;background:transparent;color:var(--muted);cursor:pointer}.nav:hover,.nav[aria-current=page]{background:var(--panel2);color:var(--text)}main{min-width:0;padding:24px}.eyebrow{color:var(--accent);font-size:11px;font-weight:700;letter-spacing:.12em}h1{margin:6px 0 8px;font-size:clamp(24px,5vw,38px);letter-spacing:-.04em}.summary{max-width:760px;margin:0 0 20px;color:var(--muted);line-height:1.55}.status{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:18px}.pill{color:var(--muted)}.pill.ok{color:var(--ok)}.cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.card{border:1px solid var(--line);border-radius:12px;padding:14px;background:var(--panel);color:var(--muted);line-height:1.45}@media(max-width:720px){.app{grid-template-columns:1fr}aside{border-right:0;border-bottom:1px solid var(--line);overflow-x:auto}nav{display:flex;min-width:max-content}.nav{white-space:nowrap}main{padding:18px}.cards{grid-template-columns:1fr}}
</style>
</head>
<body>
<div class="app"><aside><div class="brand"><strong>GPTRouter</strong><span class="badge">Synthetic / no-spend</span></div><nav id="nav" aria-label="GPTRouter sections"></nav></aside><main><div id="content">Waiting for GPTRouter tool output…</div></main></div>
<script>
const pending=new Map();let nextId=1;let snapshot=null;let activePage="overview";
function post(message){window.parent.postMessage(message,"*")}
function request(method,params){const id=nextId++;post({jsonrpc:"2.0",id,method,params});return new Promise((resolve,reject)=>pending.set(id,{resolve,reject}))}
function notify(method,params={}){post({jsonrpc:"2.0",method,params})}
function render(){if(!snapshot||!snapshot.pages)return;const nav=document.getElementById("nav");const content=document.getElementById("content");const page=snapshot.pages[activePage]||snapshot.pages.overview;nav.replaceChildren();for(const item of snapshot.navigation||[]){const b=document.createElement("button");b.type="button";b.className="nav";b.textContent=item.label;if(item.id===activePage)b.setAttribute("aria-current","page");b.addEventListener("click",()=>{activePage=item.id;render();request("ui/update-model-context",{content:[{type:"text",text:"GPTRouter UI page: "+item.label}]}).catch(()=>undefined)});nav.appendChild(b)}content.replaceChildren();const eyebrow=document.createElement("div");eyebrow.className="eyebrow";eyebrow.textContent=page.eyebrow;const title=document.createElement("h1");title.textContent=page.label;const summary=document.createElement("p");summary.className="summary";summary.textContent=page.summary;const status=document.createElement("div");status.className="status";const state=document.createElement("span");state.className="pill "+(page.status==="functional_shell"?"ok":"");state.textContent=page.status==="functional_shell"?"Functional shell":"Placeholder";const safety=document.createElement("span");safety.className="pill";safety.textContent="Provider execution disabled";status.append(state,safety);if(snapshot.runtime){for(const value of ["Routes "+snapshot.runtime.route_count,"Tasks "+snapshot.runtime.task_count,"Actual spend $"+snapshot.runtime.actual_spend.toFixed(2)]){const pill=document.createElement("span");pill.className="pill";pill.textContent=value;status.appendChild(pill)}}const cards=document.createElement("div");cards.className="cards";for(const item of page.items||[]){const card=document.createElement("section");card.className="card";card.textContent=item;cards.appendChild(card)}content.append(eyebrow,title,summary,status,cards)}
window.addEventListener("message",event=>{if(event.source!==window.parent)return;const message=event.data;if(!message||message.jsonrpc!=="2.0")return;if(message.id!==undefined&&pending.has(message.id)){const p=pending.get(message.id);pending.delete(message.id);message.error?p.reject(message.error):p.resolve(message.result);return}if(message.method==="ui/notifications/tool-input"){const input=message.params;if(input&&input.active_page)activePage=input.active_page}if(message.method==="ui/notifications/tool-result"){snapshot=message.params&&message.params.structuredContent;if(snapshot&&snapshot.active_page)activePage=snapshot.active_page;render()}},{passive:true});
const compatibilityOutput=window.openai&&window.openai.toolOutput;if(compatibilityOutput){snapshot=compatibilityOutput;if(snapshot.active_page)activePage=snapshot.active_page;render()}
request("ui/initialize",{protocolVersion:"${GPTRouterMcpAppsProtocolVersion}",appInfo:{name:"gptrouter-dashboard",title:"GPTRouter",version:"0.1.0"},appCapabilities:{availableDisplayModes:["inline"]}}).then(()=>notify("ui/notifications/initialized")).catch(()=>undefined);
</script>
</body>
</html>`;

const RenderDashboardInput = {
  active_page: z.enum(GPTRouterDashboardPageIds).optional(),
};

export interface GPTRouterDashboardUiOptions {
  getRuntimeSummary?: (context?: McpToolContext) => Promise<DashboardRuntimeSummary>;
}

export function registerGPTRouterDashboardUi(
  server: McpServer,
  options: GPTRouterDashboardUiOptions = {}
): void {
  server.registerResource('gptrouter-dashboard', GPTRouterDashboardResourceUri, {}, async () => ({
    contents: [
      {
        uri: GPTRouterDashboardResourceUri,
        mimeType: 'text/html;profile=mcp-app',
        text: GPTRouterDashboardHtml,
        _meta: {
          ui: {
            prefersBorder: true,
            csp: { connectDomains: [], resourceDomains: [] },
          },
        },
      },
    ],
  }));

  server.registerTool(
    'render_gptrouter_dashboard',
    {
      title: 'Render GPTRouter dashboard',
      description:
        'Render repository-backed synthetic GPTRouter state. Provider execution and paid calls remain disabled.',
      inputSchema: RenderDashboardInput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: {
        ui: { resourceUri: GPTRouterDashboardResourceUri },
        'openai/outputTemplate': GPTRouterDashboardResourceUri,
        'openai/toolInvocation/invoking': 'Opening GPTRouter…',
        'openai/toolInvocation/invoked': 'GPTRouter ready.',
      },
    },
    async ({ active_page }, context) => {
      const runtime = options.getRuntimeSummary
        ? await options.getRuntimeSummary(context)
        : emptyRuntimeSummary;
      const dashboard = createGPTRouterDashboardSnapshot(active_page ?? 'overview', runtime);
      return {
        structuredContent: dashboard,
        content: [
          {
            type: 'text' as const,
            text: 'Rendered repository-backed synthetic GPTRouter state. No provider execution or spending occurs.',
          },
        ],
      };
    }
  );
}
