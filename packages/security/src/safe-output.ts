import type { Connection, GatewayConnection, ProviderConnection } from '@gptrouter/contracts';

export type PublicJson =
  | null
  | boolean
  | number
  | string
  | PublicJson[]
  | { [key: string]: PublicJson };

export type SanitizationMode = 'drop' | 'redact';

export interface SanitizationOptions {
  mode?: SanitizationMode;
  maxDepth?: number;
}

const REDACTED = '[REDACTED]';

// Normalize key spelling so API_KEY, api-key and apiKey-like variants are
// treated consistently. Explicit names are preferred over broad substring
// matching to avoid redacting benign fields such as token_count.
const FORBIDDEN_NORMALIZED_KEYS = new Set([
  'authorization',
  'proxyauthorization',
  'cookie',
  'setcookie',
  'password',
  'passwd',
  'secret',
  'secretvalue',
  'clientsecret',
  'apikey',
  'accesskey',
  'privatekey',
  'bearertoken',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'sessiontoken',
  'credential',
  'credentials',
  'credentialreference',
  'vaultpath',
  'vaultreference',
  'secretpath',
]);

function normalizeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

export function isForbiddenPublicKey(key: string): boolean {
  return FORBIDDEN_NORMALIZED_KEYS.has(normalizeKey(key));
}

function sanitizeValue(
  value: unknown,
  mode: SanitizationMode,
  maxDepth: number,
  depth: number,
  seen: WeakSet<object>
): PublicJson {
  if (depth > maxDepth) return '[MAX_DEPTH]';
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return { name: value.name, message: value.message };
  }
  if (typeof value !== 'object') return String(value);

  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, mode, maxDepth, depth + 1, seen));
  }

  const output: Record<string, PublicJson> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (isForbiddenPublicKey(key)) {
      if (mode === 'redact') output[key] = REDACTED;
      continue;
    }
    output[key] = sanitizeValue(nested, mode, maxDepth, depth + 1, seen);
  }
  return output;
}

/**
 * Last-resort serializer boundary for model-visible, MCP, log, and audit data.
 * Prefer explicit DTO projections for stable public contracts; this sanitizer
 * protects dynamic diagnostic metadata and hostile nested fixtures.
 */
export function sanitizeForPublicOutput(
  value: unknown,
  options: SanitizationOptions = {}
): PublicJson {
  return sanitizeValue(
    value,
    options.mode ?? 'drop',
    options.maxDepth ?? 12,
    0,
    new WeakSet<object>()
  );
}

export interface PublicProviderConnection {
  type: 'provider';
  connection_id: string;
  provider: string;
  status: ProviderConnection['status'];
}

export interface PublicGatewayConnection {
  type: 'gateway';
  connection_id: string;
  gateway_type: string;
  gateway_origin: string;
  status: GatewayConnection['status'];
}

export type PublicConnection = PublicProviderConnection | PublicGatewayConnection;

/** Explicit allow-list projection: credential_reference never crosses boundary. */
export function projectPublicConnection(connection: Connection): PublicConnection {
  if (connection.type === 'provider') {
    return {
      type: 'provider',
      connection_id: connection.connection_id,
      provider: connection.provider,
      status: connection.status,
    };
  }

  let gatewayOrigin = 'invalid';
  try {
    gatewayOrigin = new URL(connection.gateway_url).origin;
  } catch {
    // Persisted invalid data should not cause a public serializer to leak the
    // raw value or crash an observability surface.
  }

  return {
    type: 'gateway',
    connection_id: connection.connection_id,
    gateway_type: connection.gateway_type,
    gateway_origin: gatewayOrigin,
    status: connection.status,
  };
}
