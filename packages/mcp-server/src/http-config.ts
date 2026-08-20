import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export type HttpMode = 'local' | 'remote';

export interface HttpServerConfig {
  mode: HttpMode;
  host: string;
  port: number;
  allowedHosts: string[];
  allowedOrigins: string[];
  bearerToken?: string;
}

const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '::1'];

function parsePort(raw: string | undefined): number {
  if (raw === undefined || raw === '') return 3000;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  return port;
}

function csv(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function requireEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`${key} is required in remote mode`);
  return value;
}

function normalizeConfiguredHost(host: string): string {
  const normalized = parseHostHeader(host);
  if (normalized === null || host.includes(':')) {
    if (!(host.startsWith('[') && host.endsWith(']') && normalized !== null)) {
      throw new Error(`Invalid allowed host: ${host}`);
    }
  }
  return normalized ?? host.toLowerCase();
}

function normalizeConfiguredOrigin(origin: string): string {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new Error(`Invalid allowed origin: ${origin}`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`Remote allowed origins must use HTTPS: ${origin}`);
  }
  if (
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(`Allowed origin must be an origin only: ${origin}`);
  }
  return parsed.origin.toLowerCase();
}

export function loadHttpServerConfig(env: NodeJS.ProcessEnv = process.env): HttpServerConfig {
  const modeRaw = (env.GPTROUTER_HTTP_MODE ?? 'local').trim().toLowerCase();
  if (modeRaw !== 'local' && modeRaw !== 'remote') {
    throw new Error('GPTROUTER_HTTP_MODE must be "local" or "remote"');
  }

  const port = parsePort(env.PORT);

  if (modeRaw === 'local') {
    const host = (env.HOST ?? '127.0.0.1').trim();
    if (!LOCAL_HOSTS.includes(host)) {
      throw new Error('Local mode may only bind to 127.0.0.1, localhost, or ::1');
    }
    return {
      mode: 'local',
      host,
      port,
      allowedHosts: LOCAL_HOSTS,
      allowedOrigins: [],
    };
  }

  const host = requireEnv(env, 'HOST');
  const allowedHostsRaw = csv(requireEnv(env, 'GPTROUTER_ALLOWED_HOSTS'));
  const allowedOriginsRaw = csv(requireEnv(env, 'GPTROUTER_ALLOWED_ORIGINS'));
  const bearerToken = requireEnv(env, 'GPTROUTER_BEARER_TOKEN');

  if (bearerToken.length < 32) {
    throw new Error('GPTROUTER_BEARER_TOKEN must be at least 32 characters');
  }

  const allowedHosts = [...new Set(allowedHostsRaw.map(normalizeConfiguredHost))];
  const allowedOrigins = [...new Set(allowedOriginsRaw.map(normalizeConfiguredOrigin))];

  if (allowedHosts.length === 0 || allowedOrigins.length === 0) {
    throw new Error('Remote mode requires non-empty Host and Origin allow-lists');
  }

  return {
    mode: 'remote',
    host,
    port,
    allowedHosts,
    allowedOrigins,
    bearerToken,
  };
}

export function parseHostHeader(value: string): string | null {
  const raw = value.trim();
  if (!raw || /[\s/@\\]/.test(raw)) return null;

  if (raw.startsWith('[')) {
    const end = raw.indexOf(']');
    if (end <= 1) return null;
    const rest = raw.slice(end + 1);
    if (rest && !/^:\d{1,5}$/.test(rest)) return null;
    return raw.slice(1, end).toLowerCase();
  }

  const parts = raw.split(':');
  if (parts.length > 2) return null;
  if (parts.length === 2 && !/^\d{1,5}$/.test(parts[1])) return null;
  const hostname = parts[0].toLowerCase();
  if (!hostname || !/^[a-z0-9.-]+$/.test(hostname)) return null;
  return hostname;
}

export function isAllowedHost(hostHeader: string | undefined, allowedHosts: string[]): boolean {
  if (!hostHeader) return false;
  const hostname = parseHostHeader(hostHeader);
  if (hostname === null) return false;
  return allowedHosts.some((allowed) => allowed.replace(/^\[|\]$/g, '').toLowerCase() === hostname);
}

export function isAllowedOrigin(
  originHeader: string | undefined,
  allowedOrigins: string[]
): boolean {
  if (originHeader === undefined) return true;
  if (originHeader === 'null') return false;

  let parsed: URL;
  try {
    parsed = new URL(originHeader);
  } catch {
    return false;
  }

  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    return false;
  }
  return allowedOrigins.includes(parsed.origin.toLowerCase());
}

export function hasValidBearerToken(
  authorizationHeader: string | undefined,
  expectedToken: string
): boolean {
  if (!authorizationHeader?.startsWith('Bearer ')) return false;
  const actual = authorizationHeader.slice('Bearer '.length);
  const expectedBuffer = Buffer.from(expectedToken);
  const actualBuffer = Buffer.from(actual);
  if (actualBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(actualBuffer, expectedBuffer);
}

function writeJson(res: ServerResponse, status: number, body: Record<string, unknown>): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

/** Host/Origin boundary shared by bootstrap-bearer and OAuth remote modes. */
export function applyRemoteNetworkBoundary(
  req: IncomingMessage,
  res: ServerResponse,
  config: HttpServerConfig
): boolean {
  if (config.mode !== 'remote') return true;

  if (!isAllowedHost(req.headers.host, config.allowedHosts)) {
    writeJson(res, 403, { error: 'forbidden_host' });
    return false;
  }

  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
  if (!isAllowedOrigin(origin, config.allowedOrigins)) {
    writeJson(res, 403, { error: 'forbidden_origin' });
    return false;
  }

  return true;
}

/** Bootstrap bearer mode retained for development/deployment bring-up only. */
export function applyRemoteRequestBoundary(
  req: IncomingMessage,
  res: ServerResponse,
  config: HttpServerConfig
): boolean {
  if (!applyRemoteNetworkBoundary(req, res, config)) return false;
  if (config.mode !== 'remote') return true;

  const authorization =
    typeof req.headers.authorization === 'string' ? req.headers.authorization : undefined;
  if (!config.bearerToken || !hasValidBearerToken(authorization, config.bearerToken)) {
    res.setHeader('www-authenticate', 'Bearer realm="gptrouter-mcp"');
    writeJson(res, 401, { error: 'invalid_token' });
    return false;
  }

  return true;
}
