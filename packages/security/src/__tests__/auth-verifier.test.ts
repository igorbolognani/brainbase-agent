import { describe, it, expect, beforeAll } from 'vitest';
import { SignJWT, generateKeyPair, exportJWK, type JWK, type JWTPayload } from 'jose';
import { AuthVerifier, AuthError } from '../auth-verifier.js';

describe('AuthVerifier — algorithm allowlist', () => {
  let rsaKeys: {
    publicKey: Awaited<ReturnType<typeof generateKeyPair>>['publicKey'];
    privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
  };
  let rsaPublicJwk: JWK;

  beforeAll(async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    rsaKeys = { publicKey, privateKey };
    rsaPublicJwk = await exportJWK(publicKey);
  });

  async function makeToken(claims: Record<string, unknown>, alg = 'RS256'): Promise<string> {
    const header = { alg, typ: 'JWT' };
    return new SignJWT(claims as JWTPayload).setProtectedHeader(header).sign(rsaKeys.privateKey);
  }

  describe('trusted issuer mode (production)', () => {
    it('accepts token from trusted issuer with allowed algorithm', async () => {
      const verifier = new AuthVerifier({
        trustedIssuers: [
          {
            issuer: 'https://auth.example.com',
            allowed_algorithms: ['RS256'],
            resolveJwks: async () => [rsaPublicJwk],
          },
        ],
      });
      const token = await makeToken({
        iss: 'https://auth.example.com',
        sub: 'user1',
        exp: 9999999999,
        iat: 1735686000,
      });
      const info = await verifier.verify(token);
      expect(info.issuer).toBe('https://auth.example.com');
      expect(info.subject).toBe('user1');
    });

    it('rejects token from unknown issuer when trusted issuers configured', async () => {
      const verifier = new AuthVerifier({
        trustedIssuers: [
          {
            issuer: 'https://auth.example.com',
            allowed_algorithms: ['RS256'],
            resolveJwks: async () => [rsaPublicJwk],
          },
        ],
      });
      const token = await makeToken({
        iss: 'https://unknown.example.com',
        sub: 'user1',
        exp: 9999999999,
        iat: 1735686000,
      });
      try {
        await verifier.verify(token);
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(AuthError);
        expect((e as AuthError).code).toBe('unknown_issuer');
      }
    });

    it('rejects algorithm not in allowlist', async () => {
      const verifier = new AuthVerifier({
        trustedIssuers: [
          {
            issuer: 'https://auth.example.com',
            allowed_algorithms: ['ES256'], // RS256 not allowed
            resolveJwks: async () => [rsaPublicJwk],
          },
        ],
      });
      const token = await makeToken({
        iss: 'https://auth.example.com',
        sub: 'user1',
        exp: 9999999999,
        iat: 1735686000,
      });
      try {
        await verifier.verify(token);
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(AuthError);
        expect((e as AuthError).code).toBe('algorithm_not_allowed');
      }
    });

    it('validates issuer-specific audience', async () => {
      const verifier = new AuthVerifier({
        trustedIssuers: [
          {
            issuer: 'https://auth.example.com',
            allowed_algorithms: ['RS256'],
            resolveJwks: async () => [rsaPublicJwk],
            audience: 'https://api.example.com',
          },
        ],
      });
      const token = await makeToken({
        iss: 'https://auth.example.com',
        sub: 'user1',
        aud: 'https://wrong.example.com',
        exp: 9999999999,
        iat: 1735686000,
      });
      try {
        await verifier.verify(token);
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(AuthError);
        expect((e as AuthError).code).toBe('wrong_audience');
      }
    });

    it('rejects alg=none', async () => {
      const verifier = new AuthVerifier({
        trustedIssuers: [
          {
            issuer: 'https://auth.example.com',
            allowed_algorithms: ['none'],
            resolveJwks: async () => [],
          },
        ],
      });
      // Manually craft a token with alg=none
      const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(
        JSON.stringify({
          iss: 'https://auth.example.com',
          sub: 'user1',
          exp: 9999999999,
          iat: 1735686000,
        })
      ).toString('base64url');
      const token = `${header}.${payload}.`;
      try {
        await verifier.verify(token);
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(AuthError);
      }
    });
  });

  describe('legacy mode (no trusted issuers)', () => {
    it('rejects alg=none', async () => {
      const verifier = new AuthVerifier({
        resolveJwks: async () => [rsaPublicJwk],
      });
      const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(
        JSON.stringify({
          iss: 'test',
          sub: 'user1',
          exp: 9999999999,
          iat: 1735686000,
        })
      ).toString('base64url');
      const token = `${header}.${payload}.`;
      try {
        await verifier.verify(token);
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(AuthError);
      }
    });

    it('rejects HS256', async () => {
      const verifier = new AuthVerifier({
        resolveJwks: async () => [rsaPublicJwk],
      });
      const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString(
        'base64url'
      );
      const payload = Buffer.from(
        JSON.stringify({
          iss: 'test',
          sub: 'user1',
          exp: 9999999999,
          iat: 1735686000,
        })
      ).toString('base64url');
      const token = `${header}.${payload}.sig`;
      try {
        await verifier.verify(token);
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(AuthError);
      }
    });
  });

  describe('security invariants', () => {
    it('raw token never appears in AuthInfo', async () => {
      const verifier = new AuthVerifier({
        trustedIssuers: [
          {
            issuer: 'https://auth.example.com',
            allowed_algorithms: ['RS256'],
            resolveJwks: async () => [rsaPublicJwk],
          },
        ],
      });
      const token = await makeToken({
        iss: 'https://auth.example.com',
        sub: 'user1',
        exp: 9999999999,
        iat: 1735686000,
      });
      const info = await verifier.verify(token);
      expect((info as unknown as Record<string, unknown>).raw_token).toBeUndefined();
      expect((info as unknown as Record<string, unknown>).token).toBeUndefined();
    });

    it('validates exp claim', async () => {
      const clock = () => new Date('2025-01-02T00:00:00Z');
      const verifier = new AuthVerifier({
        clock,
        trustedIssuers: [
          {
            issuer: 'https://auth.example.com',
            allowed_algorithms: ['RS256'],
            resolveJwks: async () => [rsaPublicJwk],
          },
        ],
      });
      const token = await makeToken({
        iss: 'https://auth.example.com',
        sub: 'user1',
        exp: 1735689600, // 2025-01-01T00:00:00Z
        iat: 1735686000,
      });
      try {
        await verifier.verify(token);
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(AuthError);
        expect((e as AuthError).code).toBe('token_expired');
      }
    });

    it('validates nbf claim', async () => {
      const clock = () => new Date('2024-12-31T00:00:00Z');
      const verifier = new AuthVerifier({
        clock,
        trustedIssuers: [
          {
            issuer: 'https://auth.example.com',
            allowed_algorithms: ['RS256'],
            resolveJwks: async () => [rsaPublicJwk],
          },
        ],
      });
      const token = await makeToken({
        iss: 'https://auth.example.com',
        sub: 'user1',
        exp: 9999999999,
        nbf: 1735689600, // 2025-01-01T00:00:00Z
        iat: 1735686000,
      });
      try {
        await verifier.verify(token);
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(AuthError);
        expect((e as AuthError).code).toBe('invalid_token');
      }
    });

    it('rejects missing sub', async () => {
      const verifier = new AuthVerifier({
        trustedIssuers: [
          {
            issuer: 'https://auth.example.com',
            allowed_algorithms: ['RS256'],
            resolveJwks: async () => [rsaPublicJwk],
          },
        ],
      });
      const token = await makeToken({
        iss: 'https://auth.example.com',
        exp: 9999999999,
        iat: 1735686000,
      });
      try {
        await verifier.verify(token);
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(AuthError);
        expect((e as AuthError).code).toBe('invalid_token');
      }
    });

    it('rejects future iat', async () => {
      const clock = () => new Date('2025-01-01T00:00:00Z');
      const verifier = new AuthVerifier({
        clock,
        trustedIssuers: [
          {
            issuer: 'https://auth.example.com',
            allowed_algorithms: ['RS256'],
            resolveJwks: async () => [rsaPublicJwk],
          },
        ],
      });
      const token = await makeToken({
        iss: 'https://auth.example.com',
        sub: 'user1',
        exp: 9999999999,
        iat: 1735776000, // future
      });
      try {
        await verifier.verify(token);
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(AuthError);
        expect((e as AuthError).code).toBe('invalid_token');
      }
    });
  });
});
