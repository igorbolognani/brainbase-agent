/**
 * Production Auth Verifier — jose-based JWT verification.
 * Validates JWT signature + claims server-side using jose.
 * NEVER exposes raw tokens to domain/audit/UI layers.
 *
 * Supports two modes:
 * 1. Trusted issuer configuration (production): positive algorithm allowlist per issuer
 * 2. Legacy mode: single expected issuer with global JWKS resolver
 */

import { compactVerify, decodeJwt, importJWK } from 'jose';
import type { JWK, JWTPayload, KeyInput } from 'jose';

// ─── Public types ────────────────────────────────────────────────────────────

export interface AuthInfo {
  issuer: string;
  subject: string;
  audience?: string;
  scopes?: string[];
  expires_at: Date;
  issued_at: Date;
  // raw_token deliberately omitted — never passed downstream
}

export type AuthErrorCode =
  | 'invalid_token'
  | 'wrong_issuer'
  | 'wrong_audience'
  | 'token_expired'
  | 'insufficient_scope'
  | 'unknown_issuer'
  | 'algorithm_not_allowed';

export class AuthError extends Error {
  constructor(
    readonly code: AuthErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export type JwksResolver = (issuer: string) => Promise<JWK[]>;

/**
 * Trusted issuer configuration for production auth.
 * Each issuer has an explicit set of allowed algorithms and its own JWKS resolver.
 */
export interface TrustedIssuerConfig {
  /** The issuer identifier (iss claim) */
  issuer: string;
  /** Allowed algorithms for this issuer (e.g. ['RS256', 'ES256']) */
  allowed_algorithms: string[];
  /** JWKS resolver for this issuer */
  resolveJwks: JwksResolver;
  /** Expected audience (optional, validated if present) */
  audience?: string;
}

export interface AuthVerifierOptions {
  /** Legacy: single expected issuer with global JWKS resolver */
  expectedIssuer?: string;
  /** Legacy: expected audience */
  expectedAudience?: string;
  /** Legacy: global JWKS resolver */
  resolveJwks?: JwksResolver;
  /** Trusted issuer configurations (production mode) */
  trustedIssuers?: TrustedIssuerConfig[];
  clock?: () => Date;
}

// ─── Production verifier ─────────────────────────────────────────────────────

export class AuthVerifier {
  protected readonly clock: () => Date;
  private readonly trustedIssuerMap: Map<string, TrustedIssuerConfig>;

  constructor(protected readonly options: AuthVerifierOptions = {}) {
    this.clock = options.clock ?? (() => new Date());

    // Build trusted issuer lookup map
    this.trustedIssuerMap = new Map();
    if (options.trustedIssuers) {
      for (const config of options.trustedIssuers) {
        this.trustedIssuerMap.set(config.issuer, config);
      }
    }

    // Validate: trusted issuers must not have empty allowed_algorithms
    for (const [issuer, config] of this.trustedIssuerMap) {
      if (!config.allowed_algorithms || config.allowed_algorithms.length === 0) {
        throw new Error(`Trusted issuer "${issuer}" must have at least one allowed algorithm`);
      }
    }
  }

  async verify(
    token: string,
    overrides?: { issuer?: string; audience?: string }
  ): Promise<AuthInfo> {
    if (!token || token.length === 0) {
      throw new AuthError('invalid_token', 'Token is empty');
    }

    // 1. Decode header to check algorithm BEFORE signature verification
    let header: Record<string, unknown>;
    try {
      const parts = token.split('.');
      if (parts.length < 2) throw new Error('short');
      const b64 = parts[0].replace(/-/g, '+').replace(/_/g, '/');
      const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
      header = JSON.parse(Buffer.from(padded, 'base64').toString('utf-8')) as Record<
        string,
        unknown
      >;
    } catch {
      throw new AuthError('invalid_token', 'Token has invalid format');
    }

    const alg = header.alg as string | undefined;
    if (!alg) {
      throw new AuthError('invalid_token', 'Token has no algorithm');
    }

    // 2. Decode payload to get issuer
    let payload: JWTPayload;
    try {
      payload = decodeJwt(token);
    } catch {
      throw new AuthError('invalid_token', 'Token payload is invalid');
    }

    const issuer = payload.iss;
    if (!issuer || typeof issuer !== 'string') {
      throw new AuthError('invalid_token', 'Token has no issuer');
    }

    // 3. Algorithm validation — positive allowlist
    const trustedConfig = this.trustedIssuerMap.get(issuer);
    if (trustedConfig) {
      // Production mode: check against issuer-specific allowlist
      if (!trustedConfig.allowed_algorithms.includes(alg)) {
        throw new AuthError(
          'algorithm_not_allowed',
          `Algorithm "${alg}" is not allowed for issuer "${issuer}"`
        );
      }
    } else if (this.trustedIssuerMap.size > 0) {
      // Trusted issuers configured but this issuer is unknown
      throw new AuthError('unknown_issuer', `Issuer "${issuer}" is not in the trusted issuer list`);
    } else {
      // Legacy mode: blacklist check
      const UNSAFE_ALGS = new Set(['none', 'HS256', 'HS384', 'HS512']);
      if (UNSAFE_ALGS.has(alg)) {
        throw new AuthError('invalid_token', 'Token algorithm is not acceptable');
      }
    }

    // 4. Signature verification via compactVerify
    let resolveJwks: JwksResolver | undefined;
    if (trustedConfig) {
      resolveJwks = trustedConfig.resolveJwks;
    } else {
      resolveJwks = this.options.resolveJwks;
    }

    if (!resolveJwks) {
      throw new AuthError('invalid_token', 'No JWKS resolver configured');
    }

    try {
      const keys = await resolveJwks(issuer);
      if (!keys.length) {
        throw new AuthError('invalid_token', 'No keys found for issuer');
      }

      // Try each key until one verifies
      let verified = false;
      for (const jwk of keys) {
        try {
          const key: unknown = await importJWK(jwk, alg);
          const result = await compactVerify(new TextEncoder().encode(token), key as KeyInput);
          if (result.protectedHeader.alg !== alg) continue;
          verified = true;
          break;
        } catch {
          continue;
        }
      }
      if (!verified) {
        throw new AuthError('invalid_token', 'Signature verification failed');
      }
    } catch (e) {
      if (e instanceof AuthError) throw e;
      throw new AuthError('invalid_token', 'Signature verification failed');
    }

    // 5. Claim validation
    const expectedIssuer = overrides?.issuer ?? this.options.expectedIssuer;
    if (expectedIssuer && payload.iss !== expectedIssuer) {
      throw new AuthError('wrong_issuer', 'Token issuer does not match');
    }

    const expectedAudience =
      overrides?.audience ?? trustedConfig?.audience ?? this.options.expectedAudience;
    if (expectedAudience) {
      const tokenAud = payload.aud;
      const audMatch = Array.isArray(tokenAud)
        ? tokenAud.includes(expectedAudience)
        : tokenAud === expectedAudience;
      if (!audMatch) {
        throw new AuthError('wrong_audience', 'Token audience does not match');
      }
    }

    if (typeof payload.exp !== 'number') {
      throw new AuthError('invalid_token', 'Token has no expiration');
    }
    const expiresAt = new Date(payload.exp * 1000);
    if (this.clock() > expiresAt) {
      throw new AuthError('token_expired', 'Token has expired');
    }

    if (typeof payload.nbf === 'number') {
      const notBefore = new Date(payload.nbf * 1000);
      if (this.clock() < notBefore) {
        throw new AuthError('invalid_token', 'Token not yet valid');
      }
    }

    if (typeof payload.iat === 'number') {
      const issuedAt = new Date(payload.iat * 1000);
      if (issuedAt > this.clock()) {
        throw new AuthError('invalid_token', 'Token issued in the future');
      }
    }

    const subject = typeof payload.sub === 'string' ? payload.sub : '';
    if (!subject) {
      throw new AuthError('invalid_token', 'Token has no subject');
    }

    return {
      issuer: payload.iss as string,
      subject,
      audience: typeof payload.aud === 'string' ? payload.aud : undefined,
      scopes: typeof payload.scope === 'string' ? payload.scope.split(' ') : undefined,
      expires_at: expiresAt,
      issued_at: typeof payload.iat === 'number' ? new Date(payload.iat * 1000) : new Date(),
    };
  }
}

// ─── Fake verifier for tests (no crypto) ─────────────────────────────────────

export class FakeAuthVerifier extends AuthVerifier {
  constructor(
    private readonly fakeTokens: Map<string, AuthInfo>,
    options?: AuthVerifierOptions
  ) {
    super(options);
  }

  async verify(token: string): Promise<AuthInfo> {
    const info = this.fakeTokens.get(token);
    if (!info) {
      throw new AuthError('invalid_token', 'Unknown test token');
    }
    if (info.expires_at < this.clock()) {
      throw new AuthError('token_expired', 'Token has expired');
    }
    return { ...info };
  }

  static createToken(
    issuer: string,
    subject: string,
    accountId: string,
    expiresInMs: number = 3600_000
  ): { token: string; info: AuthInfo } {
    const now = new Date();
    const info: AuthInfo = {
      issuer,
      subject,
      expires_at: new Date(now.getTime() + expiresInMs),
      issued_at: now,
    };
    const token = `fake.${Buffer.from(
      JSON.stringify({ iss: issuer, sub: subject, account_id: accountId })
    ).toString('base64url')}.sig`;
    return { token, info };
  }
}
