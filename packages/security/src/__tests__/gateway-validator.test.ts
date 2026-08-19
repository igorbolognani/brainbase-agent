/**
 * Tests for SSRF protection
 */

import { describe, it, expect } from 'vitest';
import { GatewayValidator } from '../gateway-validator.js';

describe('GatewayValidator', () => {
  const validator = new GatewayValidator();

  describe('HTTPS enforcement', () => {
    it('should reject HTTP URLs', async () => {
      const result = await validator.validate('http://example.com');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('HTTPS');
    });

    it('should accept HTTPS URLs with valid hostname', async () => {
      const result = await validator.validate('https://example.com');
      // May succeed or fail based on DNS, but should not fail on protocol
      if (!result.valid) {
        expect(result.reason).not.toContain('HTTPS');
      }
    });
  });

  describe('IP blocklist', () => {
    it('should reject loopback addresses', async () => {
      const result = await validator.validate('https://127.0.0.1');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Loopback');
    });

    it('should reject private IP ranges', async () => {
      const testCases = [
        'https://10.0.0.1',
        'https://172.16.0.1',
        'https://192.168.1.1',
      ];

      for (const url of testCases) {
        const result = await validator.validate(url);
        expect(result.valid).toBe(false);
        expect(result.reason).toContain('Private');
      }
    });

    it('should reject link-local addresses', async () => {
      const result = await validator.validate('https://169.254.169.254');
      // Should be rejected as both link-local AND cloud metadata
      expect(result.valid).toBe(false);
    });

    it('should reject cloud metadata endpoints', async () => {
      const result = await validator.validate('https://169.254.169.254');
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/metadata|Link-local/i);
    });
  });

  describe('custom blocklist', () => {
    it('should reject additional blocked IPs', async () => {
      const customValidator = new GatewayValidator({
        additionalBlockedIPs: ['203.0.113.1'],
      });

      const result = await customValidator.validate('https://203.0.113.1');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('blocklist');
    });
  });
});
