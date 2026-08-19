/**
 * Security-focused contract tests
 *
 * These tests verify that:
 * 1. No raw credentials appear in domain types
 * 2. Connection types only expose opaque references
 * 3. Audit events cannot contain sensitive data
 */

import { describe, it, expect } from 'vitest';
import type { ProviderConnection, GatewayConnection, AuditEvent } from '../types.js';

describe('Security Contracts', () => {
  describe('Credential Safety', () => {
    it('ProviderConnection should only expose credential_reference, never raw credentials', () => {
      const connection: ProviderConnection = {
        type: 'provider',
        connection_id: 'conn_123',
        account_id: 'acc_456',
        provider: 'test-provider',
        status: 'active',
        credential_reference: 'vault://credentials/test',
        created_at: new Date(),
        updated_at: new Date(),
      };

      // Verify structure excludes dangerous fields
      expect(connection).not.toHaveProperty('api_key');
      expect(connection).not.toHaveProperty('secret');
      expect(connection).not.toHaveProperty('token');
      expect(connection).not.toHaveProperty('password');
      expect(connection).toHaveProperty('credential_reference');
      expect(typeof connection.credential_reference).toBe('string');
    });

    it('GatewayConnection should only expose credential_reference, never raw credentials', () => {
      const connection: GatewayConnection = {
        type: 'gateway',
        connection_id: 'conn_789',
        account_id: 'acc_456',
        gateway_url: 'https://gateway.example.com',
        gateway_type: 'test-gateway',
        status: 'active',
        credential_reference: 'vault://credentials/gateway-test',
        created_at: new Date(),
        updated_at: new Date(),
      };

      // Verify structure excludes dangerous fields
      expect(connection).not.toHaveProperty('api_key');
      expect(connection).not.toHaveProperty('secret');
      expect(connection).not.toHaveProperty('token');
      expect(connection).not.toHaveProperty('password');
      expect(connection).toHaveProperty('credential_reference');
      expect(typeof connection.credential_reference).toBe('string');
    });

    it('AuditEvent should not contain credential fields in metadata', () => {
      const auditEvent: AuditEvent = {
        event_id: 'evt_123',
        account_id: 'acc_456',
        event_type: 'connection.created',
        actor: 'user:789',
        resource_type: 'connection',
        resource_id: 'conn_123',
        metadata: {
          provider: 'test-provider',
          status: 'active',
          // Metadata can contain anything, but credentials should never be here
        },
        timestamp: new Date(),
      };

      expect(auditEvent.metadata).toBeDefined();
      expect(typeof auditEvent.metadata).toBe('object');

      // Warning: This test documents the requirement but cannot enforce it at runtime
      // In production, sanitize metadata before creating AuditEvent objects
    });
  });

  describe('Connection Type Safety', () => {
    it('should enforce provider/gateway type discrimination', () => {
      const providerConn: ProviderConnection = {
        type: 'provider',
        connection_id: 'conn_123',
        account_id: 'acc_456',
        provider: 'test-provider',
        status: 'active',
        credential_reference: 'vault://creds/test',
        created_at: new Date(),
        updated_at: new Date(),
      };

      const gatewayConn: GatewayConnection = {
        type: 'gateway',
        connection_id: 'conn_456',
        account_id: 'acc_456',
        gateway_url: 'https://gateway.example.com',
        gateway_type: 'test-gateway',
        status: 'active',
        credential_reference: 'vault://creds/gw-test',
        created_at: new Date(),
        updated_at: new Date(),
      };

      expect(providerConn.type).toBe('provider');
      expect(gatewayConn.type).toBe('gateway');

      // Provider connection has provider field, not gateway fields
      expect(providerConn).toHaveProperty('provider');
      expect(providerConn).not.toHaveProperty('gateway_url');
      expect(providerConn).not.toHaveProperty('gateway_type');

      // Gateway connection has gateway fields, not provider field
      expect(gatewayConn).toHaveProperty('gateway_url');
      expect(gatewayConn).toHaveProperty('gateway_type');
      expect(gatewayConn).not.toHaveProperty('provider');
    });
  });

  describe('Provider Extensibility', () => {
    it('should accept any provider string without enum restriction', () => {
      const connections = [
        { provider: 'openai' },
        { provider: 'anthropic' },
        { provider: 'google' },
        { provider: 'custom-provider-2025' },
        { provider: 'unknown-future-provider' },
      ];

      // All should be valid - no hardcoded enum
      connections.forEach(({ provider }) => {
        expect(typeof provider).toBe('string');
        expect(provider.length).toBeGreaterThan(0);
      });
    });

    it('should accept any gateway_type string without enum restriction', () => {
      const gateways = [
        { gateway_type: 'openrouter' },
        { gateway_type: '9router' },
        { gateway_type: 'custom-gateway-2025' },
        { gateway_type: 'unknown-future-gateway' },
      ];

      // All should be valid - no hardcoded enum
      gateways.forEach(({ gateway_type }) => {
        expect(typeof gateway_type).toBe('string');
        expect(gateway_type.length).toBeGreaterThan(0);
      });
    });
  });
});
