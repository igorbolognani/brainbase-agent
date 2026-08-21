/**
 * Credential Store abstraction.
 * NEVER stores raw secrets in the database. Uses opaque references.
 * Supports EnvSecretStore (dev), FakeSecretStore (tests), and future Vault/KMS.
 */

export interface SecretStore {
  resolveSecret(referenceKey: string): Promise<string>;
  storeSecret(referenceKey: string, secret: string): Promise<void>;
  revokeSecret(referenceKey: string): Promise<void>;
  hasSecret(referenceKey: string): Promise<boolean>;
}

/**
 * Environment variable-based secret store for development.
 * Secrets are referenced via environment variable names.
 */
export class EnvSecretStore implements SecretStore {
  constructor(private readonly prefix: string = 'GPTR_') {}

  async resolveSecret(referenceKey: string): Promise<string> {
    const envKey = this.prefix + referenceKey.toUpperCase().replace(/-/g, '_');
    const value = process.env[envKey];
    if (value === undefined) {
      throw new Error(`secret_not_found: ${referenceKey}`);
    }
    return value;
  }

  async storeSecret(referenceKey: string, secret: string): Promise<void> {
    const envKey = this.prefix + referenceKey.toUpperCase().replace(/-/g, '_');
    process.env[envKey] = secret;
  }

  async revokeSecret(referenceKey: string): Promise<void> {
    const envKey = this.prefix + referenceKey.toUpperCase().replace(/-/g, '_');
    delete process.env[envKey];
  }

  async hasSecret(referenceKey: string): Promise<boolean> {
    const envKey = this.prefix + referenceKey.toUpperCase().replace(/-/g, '_');
    return process.env[envKey] !== undefined;
  }
}

/**
 * Deterministic fake secret store for tests.
 */
export class FakeSecretStore implements SecretStore {
  private readonly store = new Map<string, string>();

  async resolveSecret(referenceKey: string): Promise<string> {
    const value = this.store.get(referenceKey);
    if (value === undefined) {
      throw new Error(`secret_not_found: ${referenceKey}`);
    }
    return value;
  }

  async storeSecret(referenceKey: string, secret: string): Promise<void> {
    this.store.set(referenceKey, secret);
  }

  async revokeSecret(referenceKey: string): Promise<void> {
    this.store.delete(referenceKey);
  }

  async hasSecret(referenceKey: string): Promise<boolean> {
    return this.store.has(referenceKey);
  }
}
