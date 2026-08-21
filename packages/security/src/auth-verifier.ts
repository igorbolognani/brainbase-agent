/**
 * Production Auth Verifier — jose-based JWT verification.
 * Validates JWT signature + claims server-side using jose.
 * NEVER exposes raw tokens to domain/audit/UI layers.
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
  'invalid_token' | 'wrong_issuer' | 'wrong_audience' | 'token_expired' | 'insufficient_scope';

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

export interface AuthVerifierOptions {
  expectedIssuer?: string;
  expectedAudience?: string;
  resolveJwks?: JwksResolver;
  clock?: () => Date;
}

const UNSAFE_ALGS = new Set(['none', 'HS256', 'HS384', 'HS512']);

// ─── Production verifier ─────────────────────────────────────────────────────

export class AuthVerifier {
  protected readonly clock: () => Date;

  constructor(protected readonly options: AuthVerifierOptions = {}) {
    this.clock = options.clock ?? (() => new Date());
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
    if (!alg || UNSAFE_ALGS.has(alg)) {
      throw new AuthError('invalid_token', 'Token algorithm is not acceptable');
    }

    // 2. Signature verification via compactVerify (no claims checking)
    const resolveJwks = this.options.resolveJwks;
    if (!resolveJwks) {
      throw new AuthError('invalid_token', 'No JWKS resolver configured');
    }

    let payload: JWTPayload;
    try {
      // Decode payload manually so we can read `iss` to resolve JWKS
      const payloadB64 = token.split('.')[1];
      const payloadPadded =
        payloadB64.replace(/-/g, '+').replace(/_/g, '/') +
        '='.repeat((4 - (payloadB64.length % 4)) % 4);
      const preliminaryPayload = JSON.parse(
        Buffer.from(payloadPadded, 'base64').toString('utf-8')
      ) as Record<string, unknown>;

      const issuer = preliminaryPayload.iss as string | undefined;
      if (!issuer) {
        throw new AuthError('invalid_token', 'Token has no issuer');
      }

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
          payload = decodeJwt(token);
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

    // 3. Manual claim validation
    const issuer = overrides?.issuer ?? this.options.expectedIssuer;
    if (issuer && payload!.iss !== issuer) {
      throw new AuthError('wrong_issuer', 'Token issuer does not match');
    }

    const audience = overrides?.audience ?? this.options.expectedAudience;
    if (audience) {
      const tokenAud = payload!.aud;
      const audMatch = Array.isArray(tokenAud)
        ? tokenAud.includes(audience)
        : tokenAud === audience;
      if (!audMatch) {
        throw new AuthError('wrong_audience', 'Token audience does not match');
      }
    }

    if (typeof payload!.exp !== 'number') {
      throw new AuthError('invalid_token', 'Token has no expiration');
    }
    const expiresAt = new Date(payload!.exp * 1000);
    if (this.clock() > expiresAt) {
      throw new AuthError('token_expired', 'Token has expired');
    }

    if (typeof payload!.nbf === 'number') {
      const notBefore = new Date(payload!.nbf * 1000);
      if (this.clock() < notBefore) {
        throw new AuthError('invalid_token', 'Token not yet valid');
      }
    }

    if (typeof payload!.iat === 'number') {
      const issuedAt = new Date(payload!.iat * 1000);
      if (issuedAt > this.clock()) {
        throw new AuthError('invalid_token', 'Token issued in the future');
      }
    }

    const subject = typeof payload!.sub === 'string' ? payload!.sub : '';
    if (!subject) {
      throw new AuthError('invalid_token', 'Token has no subject');
    }

    return {
      issuer: payload!.iss as string,
      subject,
      audience: typeof payload!.aud === 'string' ? payload!.aud : undefined,
      scopes: typeof payload!.scope === 'string' ? payload!.scope.split(' ') : undefined,
      expires_at: expiresAt,
      issued_at: typeof payload!.iat === 'number' ? new Date(payload!.iat * 1000) : new Date(),
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
