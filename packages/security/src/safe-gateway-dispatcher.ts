import { promises as dns } from 'node:dns';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { classifyIpAddress } from './ip-safety.js';

export interface GatewayDispatchRequest {
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string | Uint8Array;
}

export interface GatewayDispatchResponse {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
  finalUrl: string;
  redirects: number;
}

export type GatewayDispatchErrorCode =
  | 'invalid_url'
  | 'https_required'
  | 'dns_failed'
  | 'unsafe_address'
  | 'redirect_missing_location'
  | 'cross_origin_redirect'
  | 'redirect_limit'
  | 'timeout'
  | 'response_too_large'
  | 'transport_error';

export class GatewayDispatchError extends Error {
  constructor(
    public readonly code: GatewayDispatchErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'GatewayDispatchError';
  }
}

export interface ResolvedTarget {
  url: URL;
  addresses: string[];
  pinnedAddress: string;
}

export interface PinnedTransportRequest {
  url: URL;
  address: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string | Uint8Array;
  signal: AbortSignal;
  maxResponseBytes: number;
}

export interface PinnedTransportResponse {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
}

export interface SafeGatewayDispatcherDeps {
  resolve?: (hostname: string) => Promise<string[]>;
  transport?: (request: PinnedTransportRequest) => Promise<PinnedTransportResponse>;
}

export interface SafeGatewayDispatcherConfig {
  maxRedirects?: number;
  timeoutMs?: number;
  maxResponseBytes?: number;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

async function defaultResolve(hostname: string): Promise<string[]> {
  if (isIP(hostname)) return [hostname];
  const results = await dns.lookup(hostname, { all: true, verbatim: true });
  return [...new Set(results.map((entry) => entry.address))];
}

function normalizeResponseHeaders(
  headers: Record<string, string | string[] | undefined>
): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    normalized[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
  }
  return normalized;
}

async function defaultTransport(
  request: PinnedTransportRequest
): Promise<PinnedTransportResponse> {
  return await new Promise((resolve, reject) => {
    const req = httpsRequest(
      request.url,
      {
        method: request.method,
        headers: request.headers,
        signal: request.signal,
        servername: request.url.hostname,
        lookup: (_hostname, _options, callback) => {
          const family = isIP(request.address);
          callback(null, request.address, family);
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let total = 0;
        res.on('data', (chunk: Buffer) => {
          total += chunk.length;
          if (total > request.maxResponseBytes) {
            req.destroy(new GatewayDispatchError('response_too_large', 'Gateway response exceeded limit'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: normalizeResponseHeaders(res.headers),
            body: Buffer.concat(chunks),
          });
        });
      }
    );
    req.on('error', reject);
    if (request.body !== undefined) req.write(request.body);
    req.end();
  });
}

function parseSafeHttpsUrl(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new GatewayDispatchError('invalid_url', 'Gateway URL is invalid');
  }
  if (parsed.protocol !== 'https:') {
    throw new GatewayDispatchError('https_required', 'Gateway dispatch requires HTTPS');
  }
  if (parsed.username || parsed.password) {
    throw new GatewayDispatchError('invalid_url', 'Gateway URL must not contain userinfo');
  }
  return parsed;
}

export class SafeGatewayDispatcher {
  private readonly maxRedirects: number;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly resolveHostname: (hostname: string) => Promise<string[]>;
  private readonly transport: (request: PinnedTransportRequest) => Promise<PinnedTransportResponse>;

  constructor(config: SafeGatewayDispatcherConfig = {}, deps: SafeGatewayDispatcherDeps = {}) {
    this.maxRedirects = config.maxRedirects ?? 3;
    this.timeoutMs = config.timeoutMs ?? 10_000;
    this.maxResponseBytes = config.maxResponseBytes ?? 1_048_576;
    this.resolveHostname = deps.resolve ?? defaultResolve;
    this.transport = deps.transport ?? defaultTransport;
  }

  private async resolveAndValidate(rawUrl: string): Promise<ResolvedTarget> {
    const url = parseSafeHttpsUrl(rawUrl);
    let addresses: string[];
    try {
      addresses = await this.resolveHostname(url.hostname);
    } catch {
      throw new GatewayDispatchError('dns_failed', 'Gateway DNS resolution failed');
    }
    addresses = [...new Set(addresses)];
    if (addresses.length === 0) {
      throw new GatewayDispatchError('dns_failed', 'Gateway DNS resolution returned no addresses');
    }

    for (const address of addresses) {
      const classification = classifyIpAddress(address);
      if (!classification.safe) {
        throw new GatewayDispatchError('unsafe_address', 'Gateway resolved to a disallowed network address');
      }
    }

    return { url, addresses, pinnedAddress: addresses[0] };
  }

  async dispatch(input: GatewayDispatchRequest): Promise<GatewayDispatchResponse> {
    const controller = new AbortController();
    let timeoutHandle: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        controller.abort();
        reject(new GatewayDispatchError('timeout', 'Gateway request timed out'));
      }, this.timeoutMs);
    });

    try {
      return await Promise.race([this.dispatchWithSignal(input, controller.signal), timeoutPromise]);
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  }

  private async dispatchWithSignal(
    input: GatewayDispatchRequest,
    signal: AbortSignal
  ): Promise<GatewayDispatchResponse> {
    let currentUrl = input.url;
    let method = input.method ?? 'POST';
    let body = input.body;
    const headers = { ...(input.headers ?? {}) };

    for (let redirectCount = 0; ; redirectCount += 1) {
      if (signal.aborted) {
        throw new GatewayDispatchError('timeout', 'Gateway request timed out');
      }

      // Resolve immediately before every actual transport call. The default
      // transport pins the socket lookup to one address from this validated set.
      const target = await this.resolveAndValidate(currentUrl);

      let response: PinnedTransportResponse;
      try {
        response = await this.transport({
          url: target.url,
          address: target.pinnedAddress,
          method,
          headers,
          body,
          signal,
          maxResponseBytes: this.maxResponseBytes,
        });
      } catch (error) {
        if (signal.aborted) {
          throw new GatewayDispatchError('timeout', 'Gateway request timed out');
        }
        if (error instanceof GatewayDispatchError) throw error;
        throw new GatewayDispatchError('transport_error', 'Gateway transport failed');
      }

      if (!REDIRECT_STATUSES.has(response.status)) {
        return {
          ...response,
          finalUrl: target.url.toString(),
          redirects: redirectCount,
        };
      }

      if (redirectCount >= this.maxRedirects) {
        throw new GatewayDispatchError('redirect_limit', 'Gateway redirect limit exceeded');
      }
      const location = response.headers.location;
      if (!location) {
        throw new GatewayDispatchError(
          'redirect_missing_location',
          'Gateway redirect omitted Location'
        );
      }

      const next = new URL(location, target.url);
      if (next.origin !== target.url.origin) {
        // V0.1 deliberately refuses cross-origin redirects rather than trying
        // to infer which credentials are safe to forward.
        throw new GatewayDispatchError(
          'cross_origin_redirect',
          'Cross-origin gateway redirects are not allowed'
        );
      }

      currentUrl = next.toString();
      if (response.status === 303) {
        method = 'GET';
        body = undefined;
      }
    }
  }
}
