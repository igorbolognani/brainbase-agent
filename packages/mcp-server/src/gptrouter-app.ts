export const GPTROUTER_APP_RESOURCE_URI = 'ui://gptrouter/app-v1.html';
export const GPTROUTER_APP_MIME_TYPE = 'text/html;profile=mcp-app';

export const GPTROUTER_NAVIGATION = [
  ['overview', 'Overview'],
  ['router', 'Router'],
  ['tasks', 'Tasks'],
  ['engineering', 'Engineering'],
  ['models', 'Models'],
  ['providers', 'Providers & Connections'],
  ['gateways', 'Model Gateways / Proxies'],
  ['usage', 'Usage & Budgets'],
  ['security', 'Security & Permissions'],
  ['activity', 'Activity / Audit'],
  ['settings', 'Settings'],
] as const;

export type GPTRouterPageId = (typeof GPTROUTER_NAVIGATION)[number][0];

export interface SafeRouteDecisionProjection {
  status: string;
  selected_route_id: string | null;
  estimated_cost: number | null;
  planning_only: true;
}

export interface GPTRouterAppProjection {
  schema_version: 1;
  data_mode: 'synthetic_fixture';
  banner: string;
  active_page: GPTRouterPageId;
  navigation: Array<{ id: GPTRouterPageId; label: string }>;
  overview: {
    status: 'phase0';
    routes_available: number;
    tasks_visible: number;
    spend_today: number;
    currency: 'USD';
  };
  router: {
    ordering_strategy: 'cost';
    planning_only: true;
    decision: SafeRouteDecisionProjection | null;
  };
  tasks: Array<{
    task_id: string;
    status: 'planning';
    description: string;
  }>;
  providers: Array<{
    connection_id: string;
    provider: string;
    status: 'active' | 'inactive';
  }>;
  gateways: Array<{
    connection_id: string;
    gateway_type: string;
    gateway_origin: string;
    status: 'active' | 'inactive';
  }>;
  engineering: {
    executor: 'not_configured';
    write_owner: 'external_executor';
    protected_branch: 'main';
    direct_main_push: false;
  };
  placeholders: Array<{ page: GPTRouterPageId; status: 'not_implemented' }>;
}

export interface RenderGPTRouterAppArgs {
  initial_page?: GPTRouterPageId;
  route_decision?: {
    status?: string;
    selected_route_id?: string | null;
    estimated_cost?: number | null;
  };
}

function safePage(page: GPTRouterPageId | undefined): GPTRouterPageId {
  return GPTROUTER_NAVIGATION.some(([id]) => id === page) ? (page ?? 'overview') : 'overview';
}

function projectRouteDecision(
  decision: RenderGPTRouterAppArgs['route_decision']
): SafeRouteDecisionProjection | null {
  if (!decision) return null;
  return {
    status: typeof decision.status === 'string' ? decision.status.slice(0, 64) : 'planning',
    selected_route_id:
      typeof decision.selected_route_id === 'string' ? decision.selected_route_id.slice(0, 128) : null,
    estimated_cost:
      typeof decision.estimated_cost === 'number' && Number.isFinite(decision.estimated_cost)
        ? decision.estimated_cost
        : null,
    planning_only: true,
  };
}

/**
 * First UI slice deliberately uses synthetic fixtures. Phase 0G replaces these
 * fixtures with repository-backed canonical projections without changing the UI contract.
 */
export function createGPTRouterAppProjection(
  args: RenderGPTRouterAppArgs = {}
): GPTRouterAppProjection {
  return {
    schema_version: 1,
    data_mode: 'synthetic_fixture',
    banner: 'Synthetic preview — no provider calls or spending.',
    active_page: safePage(args.initial_page),
    navigation: GPTROUTER_NAVIGATION.map(([id, label]) => ({ id, label })),
    overview: {
      status: 'phase0',
      routes_available: 2,
      tasks_visible: 1,
      spend_today: 0,
      currency: 'USD',
    },
    router: {
      ordering_strategy: 'cost',
      planning_only: true,
      decision: projectRouteDecision(args.route_decision),
    },
    tasks: [
      {
        task_id: 'synthetic-task-001',
        status: 'planning',
        description: 'Synthetic route-planning preview',
      },
    ],
    providers: [
      {
        connection_id: 'provider-demo-001',
        provider: 'Synthetic direct provider',
        status: 'inactive',
      },
    ],
    gateways: [
      {
        connection_id: 'gateway-demo-001',
        gateway_type: 'Synthetic gateway',
        gateway_origin: 'https://gateway.example.invalid',
        status: 'inactive',
      },
    ],
    engineering: {
      executor: 'not_configured',
      write_owner: 'external_executor',
      protected_branch: 'main',
      direct_main_push: false,
    },
    placeholders: ['models', 'usage', 'security', 'activity', 'settings'].map((page) => ({
      page: page as GPTRouterPageId,
      status: 'not_implemented' as const,
    })),
  };
}

/**
 * Single-file MCP App UI. No external scripts, fonts, images, network calls, or
 * durable browser storage. Authoritative business data is always supplied by
 * MCP tool results; local navigation is ephemeral presentation state only.
 */
export function renderGPTRouterAppHtml(): string {
  const navMarkup = GPTROUTER_NAVIGATION.map(
    ([id, label]) => `<button class="nav-item" type="button" data-page="${id}">${label}</button>`
  ).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>GPTRouter</title>
<style>
:root{color-scheme:light dark;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:transparent}
*{box-sizing:border-box}body{margin:0;padding:0;background:transparent;color:CanvasText}.shell{min-height:420px;display:grid;grid-template-columns:minmax(170px,220px) 1fr;border:1px solid color-mix(in srgb,CanvasText 14%,transparent);border-radius:16px;overflow:hidden;background:Canvas}.sidebar{padding:18px 12px;border-right:1px solid color-mix(in srgb,CanvasText 12%,transparent);background:color-mix(in srgb,Canvas 94%,CanvasText 6%)}.brand{padding:0 8px 14px;font-weight:800;letter-spacing:-.03em;font-size:18px}.brand small{display:block;margin-top:4px;font-size:10px;letter-spacing:.12em;text-transform:uppercase;font-weight:650;opacity:.55}.nav{display:flex;flex-direction:column;gap:3px}.nav-item{appearance:none;border:0;background:transparent;color:inherit;text-align:left;border-radius:9px;padding:8px 9px;font:inherit;font-size:12px;cursor:pointer}.nav-item:hover,.nav-item[aria-current="page"]{background:color-mix(in srgb,CanvasText 9%,transparent)}.main{min-width:0;padding:20px}.banner{padding:9px 11px;border-radius:10px;background:color-mix(in srgb,#eab308 18%,Canvas);border:1px solid color-mix(in srgb,#eab308 42%,transparent);font-size:11px;margin-bottom:16px}.header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:16px}.header h1{font-size:20px;letter-spacing:-.03em;margin:0}.header p{margin:4px 0 0;opacity:.62;font-size:12px}.pill{font-size:10px;padding:4px 7px;border-radius:999px;border:1px solid color-mix(in srgb,CanvasText 18%,transparent);white-space:nowrap}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.card{border:1px solid color-mix(in srgb,CanvasText 13%,transparent);border-radius:12px;padding:13px;background:color-mix(in srgb,Canvas 97%,CanvasText 3%)}.metric{font-size:23px;font-weight:760;letter-spacing:-.04em}.label{font-size:10px;text-transform:uppercase;letter-spacing:.08em;opacity:.55;margin-top:4px}.row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid color-mix(in srgb,CanvasText 10%,transparent);font-size:12px}.row:last-child{border:0}.status{font-size:10px;font-weight:700;padding:3px 6px;border-radius:999px;background:color-mix(in srgb,CanvasText 8%,transparent)}.section-title{font-weight:740;font-size:13px;margin:18px 0 8px}.muted{opacity:.62}.placeholder{padding:26px;border:1px dashed color-mix(in srgb,CanvasText 22%,transparent);border-radius:12px;text-align:center}.placeholder strong{display:block;margin-bottom:5px}.code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px}.wide{grid-column:1/-1}@media(max-width:650px){.shell{grid-template-columns:1fr;min-height:0}.sidebar{border-right:0;border-bottom:1px solid color-mix(in srgb,CanvasText 12%,transparent);padding:12px}.brand{padding-bottom:8px}.nav{display:flex;flex-direction:row;overflow:auto;padding-bottom:2px}.nav-item{flex:0 0 auto}.main{padding:14px}.grid{grid-template-columns:1fr 1fr}}@media(max-width:420px){.grid{grid-template-columns:1fr}.header{flex-direction:column}}
</style>
</head>
<body>
<div class="shell">
  <aside class="sidebar"><div class="brand">GPTRouter<small>control plane</small></div><nav class="nav" aria-label="GPTRouter navigation">${navMarkup}</nav></aside>
  <main class="main"><div id="banner" class="banner">Waiting for GPTRouter state…</div><div id="view"></div></main>
</div>
<script>
(() => {
  const view = document.getElementById('view');
  const banner = document.getElementById('banner');
  const nav = Array.from(document.querySelectorAll('.nav-item'));
  let projection = null;
  let page = 'overview';

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]));
  const money = (value) => typeof value === 'number' ? '$' + value.toFixed(4) : '—';
  const row = (left, right, status = '') => '<div class="row"><span>' + esc(left) + '</span><span class="' + (status ? 'status' : 'muted') + '">' + esc(right) + '</span></div>';
  const card = (body, extra = '') => '<section class="card ' + extra + '">' + body + '</section>';
  const title = (heading, sub) => '<div class="header"><div><h1>' + esc(heading) + '</h1><p>' + esc(sub) + '</p></div><span class="pill">MCP App · V0.1</span></div>';

  function placeholder(label) {
    return title(label, 'Canonical page reserved for a later vertical slice.') + '<div class="placeholder"><strong>Not implemented yet</strong><span class="muted">This page is intentionally a truthful placeholder.</span></div>';
  }

  function renderOverview(p) {
    return title('Overview', 'Routing, task and budget state at a glance.') + '<div class="grid">' +
      card('<div class="metric">' + esc(p.overview.routes_available) + '</div><div class="label">routes visible</div>') +
      card('<div class="metric">' + esc(p.overview.tasks_visible) + '</div><div class="label">tasks visible</div>') +
      card('<div class="metric">' + money(p.overview.spend_today) + '</div><div class="label">spend today</div>') +
      card('<div class="section-title" style="margin-top:0">Safety posture</div>' + row('Planning', 'No spend', true) + row('Direct push to main', 'Disabled', true) + row('Fixture mode', 'Synthetic', true), 'wide') +
      '</div>';
  }

  function renderRouter(p) {
    const d = p.router.decision;
    return title('Router', 'Lowest-cost adequate capability with fail-closed policy gates.') + '<div class="grid">' +
      card('<div class="metric">' + esc(p.router.ordering_strategy) + '</div><div class="label">operational strategy</div>') +
      card('<div class="metric">' + (d ? money(d.estimated_cost) : '—') + '</div><div class="label">estimated cost</div>') +
      card('<div class="metric code">' + esc(d?.selected_route_id ?? 'not planned') + '</div><div class="label">selected route</div>') +
      card('<div class="section-title" style="margin-top:0">Decision</div>' + row('Status', d?.status ?? 'No route_task result') + row('Execution', 'Planning only', true) + row('Provider spend', 'None', true), 'wide') +
      '</div>';
  }

  function renderTasks(p) {
    return title('Tasks', 'Canonical task projections; execution is not enabled in this phase.') + p.tasks.map((t) => card(row(t.task_id, t.status, true) + '<div class="muted" style="font-size:12px;padding-top:8px">' + esc(t.description) + '</div>')).join('');
  }

  function renderProviders(p) {
    return title('Providers & Connections', 'Public connection projections only; credentials never cross this boundary.') + p.providers.map((c) => card(row(c.provider, c.status, true) + row('Connection', c.connection_id))).join('');
  }

  function renderGateways(p) {
    return title('Model Gateways / Proxies', 'Gateway origin only; no credentials, secret paths, or sensitive URL details.') + p.gateways.map((c) => card(row(c.gateway_type, c.status, true) + row('Origin', c.gateway_origin) + row('Connection', c.connection_id))).join('');
  }

  function renderEngineering(p) {
    return title('Engineering', 'Executor-agnostic control plane shell.') + '<div class="grid">' +
      card('<div class="metric">' + esc(p.engineering.executor) + '</div><div class="label">executor</div>') +
      card('<div class="metric code">' + esc(p.engineering.protected_branch) + '</div><div class="label">protected branch</div>') +
      card('<div class="metric">OFF</div><div class="label">direct main push</div>') +
      card('<div class="section-title" style="margin-top:0">Boundary</div>' + row('Write owner', p.engineering.write_owner) + row('Generic workflow canvas', 'Out of scope', true), 'wide') +
      '</div>';
  }

  const labels = Object.fromEntries(${JSON.stringify(GPTROUTER_NAVIGATION)});
  function render() {
    nav.forEach((button) => button.setAttribute('aria-current', button.dataset.page === page ? 'page' : 'false'));
    if (!projection) {
      view.innerHTML = title('GPTRouter', 'Waiting for a render tool result from the MCP host.') + '<div class="placeholder"><strong>No state yet</strong><span class="muted">Call render_gptrouter_app after a data tool such as route_task.</span></div>';
      return;
    }
    banner.textContent = projection.banner || 'Synthetic preview';
    if (page === 'overview') view.innerHTML = renderOverview(projection);
    else if (page === 'router') view.innerHTML = renderRouter(projection);
    else if (page === 'tasks') view.innerHTML = renderTasks(projection);
    else if (page === 'providers') view.innerHTML = renderProviders(projection);
    else if (page === 'gateways') view.innerHTML = renderGateways(projection);
    else if (page === 'engineering') view.innerHTML = renderEngineering(projection);
    else view.innerHTML = placeholder(labels[page] || page);
  }

  nav.forEach((button) => button.addEventListener('click', () => { page = button.dataset.page; render(); }));
  window.addEventListener('message', (event) => {
    if (event.source !== window.parent) return;
    const message = event.data;
    if (!message || message.jsonrpc !== '2.0') return;
    if (message.method === 'ui/notifications/tool-result') {
      const next = message.params?.structuredContent;
      if (next?.schema_version === 1 && next?.data_mode) {
        projection = next;
        page = next.active_page || page;
        render();
      }
    }
  }, { passive: true });
  render();
})();
</script>
</body>
</html>`;
}
