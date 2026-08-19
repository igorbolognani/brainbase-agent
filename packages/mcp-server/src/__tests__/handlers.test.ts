/**
 * MCP Server Handler Tests
 * V0.1: Tests for safe, read-only tools with synthetic fixture data
 */

import { describe, it, expect } from 'vitest';
import {
  listModelsHandler,
  routeTaskHandler,
  getTaskHandler,
  getUsageHandler,
} from '../handlers.js';

describe('MCP Tool Handlers', () => {
  describe('listModelsHandler', () => {
    it('returns all models when no filter is provided', async () => {
      const result = await listModelsHandler({});
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');

      const parsed = JSON.parse(result.content[0].text) as { models: Array<{ route_id: string }> };
      expect(parsed.models).toHaveLength(2);
      expect(parsed.models[0].route_id).toBe('route-gpt4-mini');
      expect(parsed.models[1].route_id).toBe('route-claude-haiku');
    });

    it('filters models by capability', async () => {
      const result = await listModelsHandler({
        capability_filter: ['text', 'function-calling'],
      });

      const parsed = JSON.parse(result.content[0].text) as { models: unknown[] };
      expect(parsed.models).toHaveLength(2);
    });

    it('filters models by provider', async () => {
      const result = await listModelsHandler({
        provider_filter: 'openai',
      });

      const parsed = JSON.parse(result.content[0].text) as {
        models: Array<{ source_provider: string }>;
      };
      expect(parsed.models).toHaveLength(1);
      expect(parsed.models[0].source_provider).toBe('openai');
    });

    it('returns empty array when no models match filters', async () => {
      const result = await listModelsHandler({
        capability_filter: ['nonexistent-capability'],
      });

      const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
      expect(parsed.models).toHaveLength(0);
    });
  });

  describe('routeTaskHandler', () => {
    it('returns a planning decision with task_id', async () => {
      const result = await routeTaskHandler({
        description: 'Test task',
        required_capabilities: ['text'],
        ordering_strategy: 'cost',
      });

      const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
      expect(parsed.task_id).toMatch(/^task_/);
      expect(parsed.decision_id).toMatch(/^decision_/);
      expect(parsed.status).toBe('planning');
      expect(parsed.description).toBe('Test task');
      expect(parsed.selected_route).toBeDefined();
      expect(parsed.estimated_cost).toBeGreaterThan(0);
      expect(parsed.note).toContain('planning decision only');
    });

    it('preserves required_capabilities and ordering_strategy', async () => {
      const result = await routeTaskHandler({
        description: 'Another test',
        required_capabilities: ['text', 'vision'],
        ordering_strategy: 'cost',
      });

      const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
      expect(parsed.required_capabilities).toEqual(['text', 'vision']);
      expect(parsed.ordering_strategy).toBe('cost');
    });
  });

  describe('getTaskHandler', () => {
    it('returns mock task status', async () => {
      const result = await getTaskHandler({
        task_id: 'task_12345',
      });

      const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
      expect(parsed.task_id).toBe('task_12345');
      expect(parsed.status).toBe('planning');
      expect(parsed.note).toContain('not yet implemented');
    });
  });

  describe('getUsageHandler', () => {
    it('returns zero usage with default time_range', async () => {
      const result = await getUsageHandler({});

      const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
      expect(parsed.time_range).toBe('today');
      expect(parsed.total_requests).toBe(0);
      expect(parsed.total_cost).toBe(0);
      expect(parsed.note).toContain('not yet implemented');
    });

    it('respects provided time_range', async () => {
      const result = await getUsageHandler({
        time_range: 'week',
      });

      const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
      expect(parsed.time_range).toBe('week');
    });
  });
});
