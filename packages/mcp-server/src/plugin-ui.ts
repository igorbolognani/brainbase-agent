import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

export const GPTRouterDashboardResourceUri = 'ui://gptrouter/dashboard-v1.html';

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

const pageLabels: Record<GPTRouterDashboardPageId, string> = {
  overview: 'Overview',
  router: 'Router',
  tasks: 'Tasks',
  engineering: 'Engineering',
  models: 'Models',
  providers_connections: 'Providers & Connections',
  gateways_proxies: 'Model Gateways / Proxies',
  usage_budgets: 'Usage & Budgets',
  security_permissions: 'Security & Permissions',
  activity_audit: 'Activity / Audit',
  settings: 'Settings',
};

const functionalPages = new Set<GPTRouterDashboardPageId>([
  'overview',
  'router',
  'tasks',
  'engineering',
  'providers_connections',
  'gateways_proxies',
]);

export interface GPTRouterDashboardSnapshot {
  schema_version: '1';
  product: 'GPTRouter';
  data_mode: 'synthetic';
  active_page: GPTRouterDashboardPageId;
  navigation: Array<{
    id: GPTRouterDashboardPageId;
    label: string;
    status: 'functional_shell' | 'placeholder';
  }>;
  safety: {
    planning_only: true;
    provider_execution_enabled: false;
    paid_calls_enabled: false;
    fixture_data: true;
  };
  pages: Record<
    GPTRouterDashboardPageId,
    {
      title: string;
      eyebrow: string;
      status: 'functional_shell' | 'placeholder';
      summary: string;
      items: string[];
    }
  >;
}

export function createGPTRouterDashboardSnapshot(
  activePage: GPTRouterDashboardPageId = 'overview'
): GPTRouterDashboardSnapshot {
  const page = (
    id: GPTRouterDashboardPageId,
    eyebrow: string,
    summary: string,
    items: string[]
  ) => ({
    title: pageLabels[id],
    eyebrow,
    status: functionalPages.has(id) ? ('functional_shell' as const) : ('placeholder' as const),
    summary,
    items,
  });

  return {
    schema_version: '1',
    product: 'GPTRouter',
    data_mode: 'synthetic',
    active_page: activePage,
    navigation: GPTRouterDashboardPageIds.map((id) => ({
      id,
      label: pageLabels[id],
      status: functionalPages.has(id) ? 'functional_shell' : 'placeholder',
    })),
    safety: {
      planning_only: true,
      provider_execution_enabled: false,
      paid_calls_enabled: false,
      fixture_data: true,
    },
    pages: {
      overview: page(
        'overview',
        'CONTROL SURFACE',
        'Development control surface for GPTRouter. All values shown in this phase are synthetic and no-spend.',
        [
          'Routing mode: lowest-cost adequate capability',
          'Execution: disabled',
          'Remote MCP: available behind configured security boundaries',
          'Data source: synthetic fixtures until Phase 0G',
        ]
      ),
      router: page(
        'router',
        'PLANNING ONLY',
        'Routing decisions are inspectable here, but route_task remains planning-only and cannot execute providers.',
        [
          'Cost ordering is operational',
          'Quality, latency, and custom ordering fail closed',
          'Gateway HTTPS policy resolves persisted connection metadata',
          'Manual overrides use the same admissibility path',
        ]
      ),
      tasks: page(
        'tasks',
        'TASK STATE',
        'Task views expose planning state only in this phase.',
        [
          'No run_task tool is registered',
          'No provider dispatch is reachable from task planning',
          'Repository-backed task persistence is deferred to Phase 0G',
        ]
      ),
      engineering: page(
        'engineering',
        'ENGINEERING CONTROL PLANE',
        'Executor-agnostic engineering status shell for implementation checkpoints and verification.',
        [
          'GitHub remains the canonical source of code and CI evidence',
          'Builder/reviewer implementations are external to the product runtime',
          'No generic workflow-builder surface is introduced',
        ]
      ),
      models: page(
        'models',
        'PLACEHOLDER',
        'A repository-backed model catalog has not been connected yet.',
        [
          'Current list_models output is synthetic fixture data',
          'No production model or pricing catalog is hardcoded into the domain layer',
        ]
      ),
      providers_connections: page(
        'providers_connections',
        'CONNECTION BOUNDARY',
        'Provider connections remain distinct from application identity and expose only safe public projections.',
        [
          'OAuth and secure server-side secret setup remain supported connection patterns',
          'Raw credentials and vault references are never model-visible',
          'Runtime account authorization fails closed',
        ]
      ),
      gateways_proxies: page(
        'gateways_proxies',
        'SAFE GATEWAY BOUNDARY',
        'Gateway configuration is represented separately from direct provider connections.',
        [
          'HTTPS-only dispatch boundary',
          'DNS/IP/redirect validation is enforced before outbound gateway transport',
          'Private/local gateway bridge remains outside V0.1',
        ]
      ),
      usage_budgets: page(
        'usage_budgets',
        'PLACEHOLDER',
        'Usage reconciliation and durable budget accounting are not implemented yet.',
        [
          'Current get_usage response is a zero-value synthetic fixture',
          'Estimated cost is not treated as actual spend',
        ]
      ),
      security_permissions: page(
        'security_permissions',
        'PLACEHOLDER',
        'Security controls exist in the backend; this page is not yet wired to authoritative runtime state.',
        [
          'OAuth resource-server boundary is implemented',
          'Tenant membership and role checks are implemented',
          'Secret-safe public serialization is implemented',
        ]
      ),
      activity_audit: page(
        'activity_audit',
        'PLACEHOLDER',
        'Durable audit and activity storage is deferred.',
        ['Do not infer activity from synthetic UI state', 'No production usage ledger exists yet']
      ),
      settings: page(
        'settings',
        'PLACEHOLDER',
        'Account-level product settings are not persisted yet.',
        ['No UI setting in this shell mutates authoritative business state']
      ),
    },
  };
}

export const GPTRouterDashboardHtml = String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>GPTRouter</title>
    <style>
      :root {
        color-scheme: light dark;
        font-family:
          Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        --bg: #0f1115;
        --panel: #171a21;
        --panel-2: #1f232c;
        --text: #f5f7fb;
        --muted: #9aa4b2;
        --line: #2b313d;
        --accent: #8bb8ff;
        --ok: #7fd6a7;
        --warning: #f1c97a;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        background: var(--bg);
        color: var(--text);
      }

      button {
        font: inherit;
      }

      .app {
        min-height: 420px;
        display: grid;
        grid-template-columns: minmax(180px, 235px) minmax(0, 1fr);
      }

      .sidebar {
        border-right: 1px solid var(--line);
        padding: 16px 12px;
        background: var(--panel);
      }

      .brand {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin: 0 4px 14px;
      }

      .brand strong {
        letter-spacing: -0.02em;
      }

      .badge {
        border: 1px solid var(--line);
        border-radius: 999px;
        padding: 3px 7px;
        color: var(--warning);
        font-size: 11px;
        white-space: nowrap;
      }

      nav {
        display: grid;
        gap: 4px;
      }

      .nav-button {
        width: 100%;
        border: 0;
        border-radius: 8px;
        padding: 9px 10px;
        text-align: left;
        background: transparent;
        color: var(--muted);
        cursor: pointer;
      }

      .nav-button:hover,
      .nav-button[aria-current="page"] {
        background: var(--panel-2);
        color: var(--text);
      }

      .main {
        min-width: 0;
        padding: 24px;
      }

      .eyebrow {
        color: var(--accent);
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.12em;
      }

      h1 {
        margin: 6px 0 8px;
        font-size: clamp(24px, 5vw, 38px);
        letter-spacing: -0.04em;
      }

      .summary {
        max-width: 760px;
        margin: 0 0 20px;
        color: var(--muted);
        line-height: 1.55;
      }

      .status-row {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-bottom: 18px;
      }

      .status-pill {
        border: 1px solid var(--line);
        border-radius: 999px;
        padding: 6px 9px;
        color: var(--muted);
        font-size: 12px;
      }

      .status-pill.ok {
        color: var(--ok);
      }

      .cards {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
      }

      .card {
        border: 1px solid var(--line);
        border-radius: 12px;
        padding: 14px;
        background: var(--panel);
      }

      .card p {
        margin: 0;
        color: var(--muted);
        line-height: 1.45;
      }

      .empty {
        color: var(--muted);
      }

      @media (max-width: 720px) {
        .app {
          grid-template-columns: 1fr;
        }

        .sidebar {
          border-right: 0;
          border-bottom: 1px solid var(--line);
          overflow-x: auto;
        }

        nav {
          display: flex;
          min-width: max-content;
        }

        .nav-button {
          width: auto;
          white-space: nowrap;
        }

        .main {
          padding: 18px;
        }

        .cards {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <div class="app">
      <aside class="sidebar">
        <div class="brand">
          <strong>GPTRouter</strong>
          <span class="badge">Synthetic / no-spend</span>
        </div>
        <nav id="nav" aria-label="GPTRouter sections"></nav>
      </aside>
      <main class="main">
        <div id="content" class="empty">Waiting for GPTRouter tool output…</div>
      </main>
    </div>
    <script>
      const pendingRequests = new Map();
      let nextRequestId = 1;
      let snapshot = null;
      let activePage = "overview";

      function request(method, params) {
        const id = nextRequestId++;
        window.parent.postMessage({ jsonrpc: "2.0", id, method, params }, "*");
        return new Promise((resolve, reject) => {
          pendingRequests.set(id, { resolve, reject });
        });
      }

      function render() {
        if (!snapshot || !snapshot.pages) return;
        const nav = document.getElementById("nav");
        const content = document.getElementById("content");
        const page = snapshot.pages[activePage] || snapshot.pages.overview;

        nav.replaceChildren();
        for (const item of snapshot.navigation || []) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "nav-button";
          button.textContent = item.label;
          if (item.id === activePage) button.setAttribute("aria-current", "page");
          button.addEventListener("click", () => {
            activePage = item.id;
            render();
            request("ui/update-model-context", {
              content: [{ type: "text", text: "GPTRouter UI page: " + item.label }],
            }).catch(() => undefined);
          });
          nav.appendChild(button);
        }

        content.replaceChildren();
        const eyebrow = document.createElement("div");
        eyebrow.className = "eyebrow";
        eyebrow.textContent = page.eyebrow;
        const title = document.createElement("h1");
        title.textContent = page.title;
        const summary = document.createElement("p");
        summary.className = "summary";
        summary.textContent = page.summary;

        const statusRow = document.createElement("div");
        statusRow.className = "status-row";
        const status = document.createElement("span");
        status.className = "status-pill " + (page.status === "functional_shell" ? "ok" : "");
        status.textContent = page.status === "functional_shell" ? "Functional shell" : "Placeholder";
        const safety = document.createElement("span");
        safety.className = "status-pill";
        safety.textContent = "Provider execution disabled";
        statusRow.append(status, safety);

        const cards = document.createElement("div");
        cards.className = "cards";
        for (const item of page.items || []) {
          const card = document.createElement("section");
          card.className = "card";
          const text = document.createElement("p");
          text.textContent = item;
          card.appendChild(text);
          cards.appendChild(card);
        }

        content.append(eyebrow, title, summary, statusRow, cards);
      }

      window.addEventListener(
        "message",
        (event) => {
          if (event.source !== window.parent) return;
          const message = event.data;
          if (!message || message.jsonrpc !== "2.0") return;

          if (message.id !== undefined && pendingRequests.has(message.id)) {
            const pending = pendingRequests.get(message.id);
            pendingRequests.delete(message.id);
            if (message.error) pending.reject(message.error);
            else pending.resolve(message.result);
            return;
          }

          if (message.method === "ui/notifications/tool-input") {
            const input = message.params;
            if (input && input.active_page) activePage = input.active_page;
          }

          if (message.method === "ui/notifications/tool-result") {
            snapshot = message.params && message.params.structuredContent;
            if (snapshot && snapshot.active_page) activePage = snapshot.active_page;
            render();
          }
        },
        { passive: true }
      );

      const compatibilityOutput = window.openai && window.openai.toolOutput;
      if (compatibilityOutput) {
        snapshot = compatibilityOutput;
        if (snapshot.active_page) activePage = snapshot.active_page;
        render();
      }

      request("ui/initialize", {
        protocolVersion: "2026-05-01",
        clientInfo: { name: "gptrouter-dashboard", version: "0.1.0" },
        capabilities: {},
      }).catch(() => undefined);
    </script>
  </body>
</html>`;

const RenderDashboardInput = {
  active_page: z.enum(GPTRouterDashboardPageIds).optional(),
};

export function registerGPTRouterDashboardUi(server: McpServer): void {
  server.registerResource(
    'gptrouter-dashboard',
    GPTRouterDashboardResourceUri,
    {},
    async () => ({
      contents: [
        {
          uri: GPTRouterDashboardResourceUri,
          mimeType: 'text/html;profile=mcp-app',
          text: GPTRouterDashboardHtml,
          _meta: {
            ui: {
              prefersBorder: true,
              csp: {
                connectDomains: [],
                resourceDomains: [],
              },
            },
          },
        },
      ],
    })
  );

  server.registerTool(
    'render_gptrouter_dashboard',
    {
      title: 'Render GPTRouter dashboard',
      description:
        'Render the GPTRouter development control surface. The Phase 0F dashboard is synthetic/no-spend and must not be treated as authoritative production state.',
      inputSchema: RenderDashboardInput,
      _meta: {
        ui: { resourceUri: GPTRouterDashboardResourceUri },
        'openai/outputTemplate': GPTRouterDashboardResourceUri,
        'openai/toolInvocation/invoking': 'Opening GPTRouter…',
        'openai/toolInvocation/invoked': 'GPTRouter ready.',
      },
    },
    async ({ active_page }) => {
      const dashboard = createGPTRouterDashboardSnapshot(active_page ?? 'overview');
      return {
        structuredContent: dashboard,
        content: [
          {
            type: 'text' as const,
            text: 'Rendered the GPTRouter Phase 0F control surface using synthetic, planning-only, no-spend state.',
          },
        ],
      };
    }
  );
}
