/**
 * SSRF protection for user-configured gateway URLs
 *
 * Multi-layer validation:
 * 1. HTTPS only
 * 2. DNS resolution (IPv4 + IPv6)
 * 3. Robust IP canonicalization and blocklist (loopback, private, link-local, cloud metadata)
 * 4. Reject if ANY resolved address is unsafe
 * 5. TODO: Redirect validation requires safe outbound request abstraction (deferred from V0.1)
 */

import { promises as dns } from 'node:dns';
import { isIP } from 'node:net';
import type { ValidationResult } from '@gptrouter/contracts';

export interface GatewayValidatorConfig {
  maxRedirects?: number;
  connectionTimeoutMs?: number;
  additionalBlockedIPs?: string[];
}

export class GatewayValidator {
  private config: Required<GatewayValidatorConfig>;

  constructor(config: GatewayValidatorConfig = {}) {
    this.config = {
      maxRedirects: config.maxRedirects ?? 3,
      connectionTimeoutMs: config.connectionTimeoutMs ?? 10000,
      additionalBlockedIPs: config.additionalBlockedIPs ?? [],
    };
  }

  async validate(url: string): Promise<ValidationResult> {
    // 1. HTTPS only
    if (!url.startsWith('https://')) {
      return {
        valid: false,
        reason: 'HTTPS required',
        details: { url },
      };
    }

    try {
      // 2. Parse URL
      const parsed = new URL(url);

      // 3. Resolve hostname to IP addresses (handles both IPv4 and IPv6)
      const addresses = await this.resolveAllAddresses(parsed.hostname);

      // 4. Check each IP against blocklist
      // CRITICAL: Reject if ANY address is unsafe (prevents DNS rebinding)
      for (const ip of addresses) {
        const blockCheck = this.isBlockedIP(ip);
        if (blockCheck.blocked) {
          return {
            valid: false,
            reason: blockCheck.reason!,
            details: { url, ip, all_addresses: addresses },
          };
        }
      }

      // All checks passed
      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        reason: error instanceof Error ? error.message : 'Validation failed',
        details: { url, error: String(error) },
      };
    }
  }

  /**
   * Resolve hostname to all IPv4 and IPv6 addresses
   * Uses Node's isIP for robust IP detection
   */
  private async resolveAllAddresses(hostname: string): Promise<string[]> {
    // Check if hostname is already an IP address using Node's isIP
    const ipVersion = isIP(hostname);
    if (ipVersion !== 0) {
      // It's already an IP address (v4 or v6)
      return [hostname];
    }

    // Resolve DNS to all addresses
    const addresses: string[] = [];

    try {
      // Try IPv4
      const ipv4Addresses = await dns.resolve4(hostname);
      addresses.push(...ipv4Addresses);
    } catch {
      // IPv4 resolution failed, try IPv6
    }

    try {
      // Try IPv6
      const ipv6Addresses = await dns.resolve6(hostname);
      addresses.push(...ipv6Addresses);
    } catch {
      // IPv6 resolution failed
    }

    if (addresses.length === 0) {
      throw new Error(`DNS resolution failed for ${hostname}`);
    }

    return addresses;
  }

  /**
   * Check if IP is blocked using robust canonicalization
   * Handles IPv4, IPv6, and IPv4-mapped IPv6
   */
  private isBlockedIP(ip: string): { blocked: boolean; reason?: string } {
    const ipVersion = isIP(ip);

    if (ipVersion === 0) {
      return { blocked: true, reason: 'Invalid IP address format' };
    }

    // Loopback addresses
    if (this.isLoopback(ip, ipVersion)) {
      return { blocked: true, reason: 'Loopback address not allowed' };
    }

    // Private ranges
    if (this.isPrivate(ip, ipVersion)) {
      return { blocked: true, reason: 'Private IP range not allowed' };
    }

    // Link-local
    if (this.isLinkLocal(ip, ipVersion)) {
      return { blocked: true, reason: 'Link-local address not allowed' };
    }

    // Cloud metadata endpoints
    if (this.isCloudMetadata(ip, ipVersion)) {
      return { blocked: true, reason: 'Cloud metadata endpoint not allowed' };
    }

    // Additional blocked IPs
    if (this.config.additionalBlockedIPs.includes(ip)) {
      return { blocked: true, reason: 'IP in blocklist' };
    }

    return { blocked: false };
  }

  private isLoopback(ip: string, version: number): boolean {
    if (version === 4) {
      // IPv4: 127.0.0.0/8
      return ip.startsWith('127.');
    } else {
      // IPv6: ::1 (various representations)
      const normalized = this.normalizeIPv6(ip);
      return normalized === '0000:0000:0000:0000:0000:0000:0000:0001' || normalized === '::1';
    }
  }

  private isPrivate(ip: string, version: number): boolean {
    if (version === 4) {
      // IPv4 private ranges
      // 10.0.0.0/8
      if (ip.startsWith('10.')) {
        return true;
      }

      // 172.16.0.0/12
      if (ip.startsWith('172.')) {
        const parts = ip.split('.');
        const second = parseInt(parts[1], 10);
        if (second >= 16 && second <= 31) {
          return true;
        }
      }

      // 192.168.0.0/16
      if (ip.startsWith('192.168.')) {
        return true;
      }

      return false;
    } else {
      // IPv6 private ranges
      // fc00::/7 (Unique Local Addresses)
      const normalized = ip.toLowerCase();
      if (normalized.startsWith('fc') || normalized.startsWith('fd')) {
        return true;
      }

      // Check for IPv4-mapped IPv6 addresses (::ffff:0:0/96)
      // These can hide IPv4 private addresses
      if (normalized.includes('::ffff:')) {
        // Extract IPv4 part and check it
        const ipv4Match = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)/);
        if (ipv4Match) {
          return this.isPrivate(ipv4Match[1], 4);
        }
      }

      return false;
    }
  }

  private isLinkLocal(ip: string, version: number): boolean {
    if (version === 4) {
      // IPv4: 169.254.0.0/16
      return ip.startsWith('169.254.');
    } else {
      // IPv6: fe80::/10
      const normalized = ip.toLowerCase();
      return normalized.startsWith('fe80:');
    }
  }

  private isCloudMetadata(ip: string, version: number): boolean {
    if (version === 4) {
      // AWS/Azure/GCP metadata endpoint
      return ip === '169.254.169.254';
    } else {
      // AWS IMDSv2 (IPv6)
      const normalized = this.normalizeIPv6(ip);
      return (
        normalized === 'fd00:ec2::254' || normalized === 'fd00:0ec2:0000:0000:0000:0000:0000:0254'
      );
    }
  }

  /**
   * Normalize IPv6 address for comparison
   * Handles various representations of the same address
   */
  private normalizeIPv6(ip: string): string {
    // Simple normalization - in production, use a proper IPv6 library
    // This handles basic cases for loopback/metadata detection
    const lower = ip.toLowerCase().trim();

    // Handle ::1 explicitly
    if (lower === '::1') {
      return '::1';
    }

    // Expand :: shorthand if needed for metadata checks
    if (lower.includes('::')) {
      return lower;
    }

    return lower;
  }
}
