/**
 * Production Auth Verifier boundary using jose for cryptographic JWT verification.
 * Validates JWT/OIDC tokens with signature verification, issuer, audience, expiry.
 * NEVER exposes raw tokens to domain/audit/UI layers.
 * Injectable JWKS resolution for flexible deployment.
 */

import * as jose from 'jose';

export interface AuthInfo {
  issuer: string;
  subject: string;
  audience?: string;
  scopes?: string[];
  expires_at: Date;
  issued_at: Date;
  // raw_token deliberately omitted — never passed downstream
}

export interface AuthVerifierOptions {
  expectedIssuer?: string;
  expectedAudience?: string;
  clock?: () => Date;
  /**
   * Injectable JWKS resolver. Receives the issuer from the token header/payload
   * and must return the matching signing keys. This enables:
   * - Local/static JWK sets in tests
   * - JWKS endpoint resolution in production
   * - Multi-issuer support
   */
  jwksResolver?: (issuer: string) => Promise<jose.JWK[]>;
}

export class AuthVerifier {
  protected readonly clock: () => Date;

  constructor(private readonly options: AuthVerifierOptions = {}) {
    this.clock = options.clock ?? (() => new Date());
  }

  /**
   * Verify a bearer token with cryptographic signature verification.
   * Returns safe AuthInfo WITHOUT the raw token.
   */
  async verify(token: string, options?: { issuer?: string; audience?: string }): Promise<AuthInfo> {
    if (!token || token.length === 0) {
      throw new AuthError('invalid_token', 'Token is empty');
    }

    // Parse header to check algorithm before attempting verification
    let header: jose.ProtectedHeaderParameters;
    try {
      header = jose.decodeProtectedHeader(token);
    } catch {
      throw new AuthError('invalid_token', 'Token has invalid format');
    }

    // Reject alg=none
    const alg = header.alg;
    if (!alg || alg === 'none') {
      throw new AuthError('invalid_token', 'Token algorithm is not acceptable');
    }

    // Attempt cryptographic signature verification using jose compactVerify.
    // We verify signature only — claim validation (exp, iss, aud) is done below
    // for precise error mapping.
    let payload: jose.JWTPayload;
    try {
      if (!this.options.jwksResolver) {
        throw new AuthError(
          'invalid_token',
          'JWKS resolver is required for cryptographic verification'
        );
      }

      const issuerHint = typeof header.iss === 'string' ? header.iss : '';
      const keys = await this.options.jwksResolver(issuerHint);
      if (!keys || keys.length === 0) {
        throw new AuthError('invalid_token', 'No signing keys available for verification');
      }

      // Try each key until one succeeds
      let lastError: Error | null = null;
      let verified = false;
      for (const jwk of keys) {
        try {
          const cryptoKey = await jose.importJWK(jwk, alg);
          // compactVerify only checks signature, not claims
          const compact = token.split('.').slice(0, 2).join('.') + '.' + token.split('.')[2];
          await jose.compactVerify(compact, cryptoKey as jose.KeyInput);
          // Signature valid — now decode payload for claim checks
          payload = jose.decodeJwt(token);
          verified = true;
          break;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
        }
      }
      if (!verified) {
        throw lastError ?? new Error('No verification keys succeeded');
      }
    } catch (error) {
      if (error instanceof AuthError) throw error;
      throw new AuthError('invalid_token', 'Token signature verification failed');
    }

    // Issuer validation
    const issuer = options?.issuer ?? this.options.expectedIssuer;
    if (issuer && payload!.iss !== issuer) {
      throw new AuthError('wrong_issuer', 'Token issuer does not match');
    }

    // Audience validation
    const audience = options?.audience ?? this.options.expectedAudience;
    if (audience) {
      const tokenAud = payload!.aud;
      const audMatch = Array.isArray(tokenAud)
        ? tokenAud.includes(audience)
        : tokenAud === audience;
      if (!audMatch) {
        throw new AuthError('wrong_audience', 'Token audience does not match');
      }
    }

    // Expiry validation
    if (typeof payload!.exp !== 'number') {
      throw new AuthError('invalid_token', 'Token has no expiration');
    }
    const expiresAt = new Date(payload!.exp * 1000);
    if (this.clock() > expiresAt) {
      throw new AuthError('token_expired', 'Token has expired');
    }

    // Not-before validation
    if (typeof payload!.nbf === 'number') {
      const notBefore = new Date(payload!.nbf * 1000);
      if (this.clock() < notBefore) {
        throw new AuthError('invalid_token', 'Token is not yet valid');
      }
    }

    // Issued-at validation (reject tokens from the future)
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

    // Return AuthInfo WITHOUT the raw token
    return {
      issuer: payload!.iss as string,
      subject,
      audience: typeof payload!.aud === 'string' ? payload!.aud : undefined,
      scopes: typeof payload!.scope === 'string' ? payload!.scope.split(' ') : undefined,
      expires_at: expiresAt,
      issued_at: typeof payload!.iat === 'number' ? new Date(payload!.iat * 1000) : new Date(),
      // raw_token deliberately omitted — never passed downstream
    };
  }
}

export class AuthError extends Error {
  constructor(
    readonly code:
      'invalid_token' | 'wrong_issuer' | 'wrong_audience' | 'token_expired' | 'insufficient_scope',
    message: string
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

/**
 * Fake auth verifier for tests. Produces deterministic AuthInfo from a token string.
 * Does NOT perform cryptographic verification — test-only.
 */
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
    const clock = this.clock;
    if (clock && info.expires_at < clock()) {
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
    // Deterministic test token - not a real JWT, used only in unit tests
    const token = `fake.${Buffer.from(JSON.stringify({ iss: issuer, sub: subject, account_id: accountId })).toString('base64url')}.sig`;
    return { token, info };
  }
}
