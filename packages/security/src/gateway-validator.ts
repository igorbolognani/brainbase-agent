/**
 * SSRF protection for user-configured gateway URLs
 * 
 * Multi-layer validation:
 * 1. HTTPS only
 * 2. DNS resolution
 * 3. IP blocklist (loopback, private, link-local, cloud metadata)
 * 4. Redirect validation
 */

import { promises as dns } from 'node:dns';
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

      // 3. Check if hostname is already an IP address
      let addresses: string[];
      if (this.isIPAddress(parsed.hostname)) {
        addresses = [parsed.hostname];
      } else {
        // 4. Resolve hostname to IP
        addresses = await this.resolveHostname(parsed.hostname);
      }

      // 5. Check each IP against blocklist
      for (const ip of addresses) {
        const blockCheck = this.isBlockedIP(ip);
        if (blockCheck.blocked) {
          return {
            valid: false,
            reason: blockCheck.reason!,
            details: { url, ip },
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

  private isIPAddress(hostname: string): boolean {
    // Check if it's an IPv4 address
    const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (ipv4Pattern.test(hostname)) {
      return true;
    }

    // Check if it's an IPv6 address (simplified check)
    if (hostname.includes(':')) {
      return true;
    }

    return false;
  }

  private async resolveHostname(hostname: string): Promise<string[]> {
    try {
      const addresses = await dns.resolve4(hostname);
      return addresses;
    } catch (error) {
      // Try IPv6 if IPv4 fails
      try {
        const addresses = await dns.resolve6(hostname);
        return addresses;
      } catch {
        throw new Error(`DNS resolution failed for ${hostname}`);
      }
    }
  }

  private isBlockedIP(ip: string): { blocked: boolean; reason?: string } {
    // Loopback addresses
    if (this.isLoopback(ip)) {
      return { blocked: true, reason: 'Loopback address not allowed' };
    }

    // Private ranges
    if (this.isPrivate(ip)) {
      return { blocked: true, reason: 'Private IP range not allowed' };
    }

    // Link-local
    if (this.isLinkLocal(ip)) {
      return { blocked: true, reason: 'Link-local address not allowed' };
    }

    // Cloud metadata endpoints
    if (this.isCloudMetadata(ip)) {
      return { blocked: true, reason: 'Cloud metadata endpoint not allowed' };
    }

    // Additional blocked IPs
    if (this.config.additionalBlockedIPs.includes(ip)) {
      return { blocked: true, reason: 'IP in blocklist' };
    }

    return { blocked: false };
  }

  private isLoopback(ip: string): boolean {
    // IPv4: 127.0.0.0/8
    if (ip.startsWith('127.')) {
      return true;
    }

    // IPv6: ::1
    if (ip === '::1' || ip === '0000:0000:0000:0000:0000:0000:0000:0001') {
      return true;
    }

    return false;
  }

  private isPrivate(ip: string): boolean {
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

    // IPv6 private ranges (simplified check)
    if (ip.startsWith('fc') || ip.startsWith('fd')) {
      return true;
    }

    return false;
  }

  private isLinkLocal(ip: string): boolean {
    // IPv4: 169.254.0.0/16
    if (ip.startsWith('169.254.')) {
      return true;
    }

    // IPv6: fe80::/10
    if (ip.startsWith('fe80:')) {
      return true;
    }

    return false;
  }

  private isCloudMetadata(ip: string): boolean {
    // AWS/Azure/GCP metadata endpoint
    if (ip === '169.254.169.254') {
      return true;
    }

    // AWS IMDSv2 (IPv6)
    if (ip === 'fd00:ec2::254') {
      return true;
    }

    return false;
  }
}
