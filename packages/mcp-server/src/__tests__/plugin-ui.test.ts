import { describe, expect, it } from 'vitest';
import {
  createGPTRouterDashboardSnapshot,
  GPTRouterDashboardHtml,
  GPTRouterDashboardPageIds,
  GPTRouterDashboardResourceUri,
  GPTRouterMcpAppsProtocolVersion,
} from '../plugin-ui.js';

describe('GPTRouter MCP Apps UI', () => {
  it('exposes the complete canonical navigation with honest page status', () => {
    const snapshot = createGPTRouterDashboardSnapshot();

    expect(snapshot.navigation.map((item) => item.id)).toEqual(GPTRouterDashboardPageIds);
    expect(snapshot.navigation.map((item) => item.label)).toEqual([
      'Overview',
      'Router',
      'Tasks',
      'Engineering',
      'Models',
      'Providers & Connections',
      'Model Gateways / Proxies',
      'Usage & Budgets',
      'Security & Permissions',
      'Activity / Audit',
      'Settings',
    ]);
    expect(
      snapshot.navigation
        .filter((item) => item.status === 'functional_shell')
        .map((item) => item.id)
    ).toEqual([
      'overview',
      'router',
      'tasks',
      'engineering',
      'providers_connections',
      'gateways_proxies',
    ]);
  });

  it('is explicitly synthetic, planning-only, and no-spend', () => {
    const snapshot = createGPTRouterDashboardSnapshot('router');

    expect(snapshot.active_page).toBe('router');
    expect(snapshot.data_mode).toBe('synthetic');
    expect(snapshot.safety).toEqual({
      planning_only: true,
      provider_execution_enabled: false,
      paid_calls_enabled: false,
      fixture_data: true,
    });
    expect(snapshot.pages.tasks.items).toContain('No run_task tool is registered');
  });

  it('uses the stable MCP Apps view handshake and no external asset dependency', () => {
    expect(GPTRouterMcpAppsProtocolVersion).toBe('2026-01-26');
    expect(GPTRouterDashboardResourceUri).toBe('ui://gptrouter/dashboard-v1.html');
    expect(GPTRouterDashboardHtml).toContain('Synthetic / no-spend');
    expect(GPTRouterDashboardHtml).toContain('ui/initialize');
    expect(GPTRouterDashboardHtml).toContain('appInfo');
    expect(GPTRouterDashboardHtml).toContain('appCapabilities');
    expect(GPTRouterDashboardHtml).toContain('ui/notifications/initialized');
    expect(GPTRouterDashboardHtml).toContain('ui/notifications/tool-result');
    expect(GPTRouterDashboardHtml).not.toContain('https://cdn.');
  });
});
