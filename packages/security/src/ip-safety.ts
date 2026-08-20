import { isIP } from 'node:net';

export interface IpSafetyResult {
  safe: boolean;
  reason?: string;
  canonical?: string;
}

function parseIPv4(ip: string): number[] | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const bytes = parts.map((part) => {
    if (!/^\d{1,3}$/.test(part)) return -1;
    const value = Number(part);
    return Number.isInteger(value) && value >= 0 && value <= 255 ? value : -1;
  });
  return bytes.every((value) => value >= 0) ? bytes : null;
}

function expandIpv4Tail(parts: string[]): string[] | null {
  if (parts.length === 0) return parts;
  const tail = parts.at(-1)!;
  if (!tail.includes('.')) return parts;
  const bytes = parseIPv4(tail);
  if (!bytes) return null;
  return [
    ...parts.slice(0, -1),
    ((bytes[0] << 8) | bytes[1]).toString(16),
    ((bytes[2] << 8) | bytes[3]).toString(16),
  ];
}

function parseIPv6(ip: string): number[] | null {
  const zoneIndex = ip.indexOf('%');
  const raw = (zoneIndex >= 0 ? ip.slice(0, zoneIndex) : ip).toLowerCase();
  if (!raw.includes(':')) return null;

  const doubleColon = raw.indexOf('::');
  if (doubleColon !== raw.lastIndexOf('::')) return null;

  let left = raw;
  let right = '';
  if (doubleColon >= 0) {
    left = raw.slice(0, doubleColon);
    right = raw.slice(doubleColon + 2);
  }

  let leftParts = left ? left.split(':') : [];
  let rightParts = right ? right.split(':') : [];
  const expandedLeft = expandIpv4Tail(leftParts);
  const expandedRight = expandIpv4Tail(rightParts);
  if (!expandedLeft || !expandedRight) return null;
  leftParts = expandedLeft;
  rightParts = expandedRight;

  const parseHextet = (value: string): number | null => {
    if (!/^[0-9a-f]{1,4}$/.test(value)) return null;
    return Number.parseInt(value, 16);
  };

  const leftValues = leftParts.map(parseHextet);
  const rightValues = rightParts.map(parseHextet);
  if (leftValues.some((value) => value === null) || rightValues.some((value) => value === null)) {
    return null;
  }

  const explicitCount = leftValues.length + rightValues.length;
  if (doubleColon < 0 && explicitCount !== 8) return null;
  if (doubleColon >= 0 && explicitCount >= 8) return null;
  const zeros = doubleColon >= 0 ? 8 - explicitCount : 0;
  const hextets = [
    ...(leftValues as number[]),
    ...Array.from({ length: zeros }, () => 0),
    ...(rightValues as number[]),
  ];
  if (hextets.length !== 8) return null;

  const bytes: number[] = [];
  for (const value of hextets) {
    bytes.push((value >> 8) & 0xff, value & 0xff);
  }
  return bytes;
}

function ipv4Reason(bytes: number[]): string | null {
  const [a, b] = bytes;
  if (a === 0) return 'unspecified_or_current_network';
  if (a === 10) return 'private';
  if (a === 100 && b >= 64 && b <= 127) return 'carrier_grade_nat';
  if (a === 127) return 'loopback';
  if (a === 169 && b === 254) return 'link_local_or_metadata';
  if (a === 172 && b >= 16 && b <= 31) return 'private';
  if (a === 192 && b === 0) return 'ietf_protocol_assignment';
  if (a === 192 && b === 168) return 'private';
  if (a === 198 && (b === 18 || b === 19)) return 'benchmark';
  if (a === 192 && b === 0 && bytes[2] === 2) return 'documentation';
  if (a === 198 && b === 51 && bytes[2] === 100) return 'documentation';
  if (a === 203 && b === 0 && bytes[2] === 113) return 'documentation';
  if (a >= 224 && a <= 239) return 'multicast';
  if (a >= 240) return 'reserved';
  return null;
}

function ipv6Reason(bytes: number[]): string | null {
  const allZero = bytes.every((value) => value === 0);
  if (allZero) return 'unspecified';

  const loopback = bytes.slice(0, 15).every((value) => value === 0) && bytes[15] === 1;
  if (loopback) return 'loopback';

  const mapped = bytes.slice(0, 10).every((value) => value === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
  if (mapped) return ipv4Reason(bytes.slice(12)) ?? null;

  if ((bytes[0] & 0xfe) === 0xfc) return 'unique_local';
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return 'link_local';
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0xc0) return 'site_local_reserved';
  if (bytes[0] === 0xff) return 'multicast';
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) {
    return 'documentation';
  }
  return null;
}

export function classifyIpAddress(ip: string): IpSafetyResult {
  const version = isIP(ip);
  if (version === 4) {
    const bytes = parseIPv4(ip);
    if (!bytes) return { safe: false, reason: 'invalid_ip' };
    const reason = ipv4Reason(bytes);
    return reason ? { safe: false, reason } : { safe: true, canonical: bytes.join('.') };
  }

  if (version === 6) {
    const bytes = parseIPv6(ip);
    if (!bytes) return { safe: false, reason: 'invalid_ip' };
    const reason = ipv6Reason(bytes);
    return reason ? { safe: false, reason } : { safe: true, canonical: ip.toLowerCase() };
  }

  return { safe: false, reason: 'invalid_ip' };
}
