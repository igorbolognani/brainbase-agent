import type { CredentialResolver } from '@gptrouter/domain';
import type { SecretStore } from '@gptrouter/persistence';

export class SecretStoreCredentialResolver implements CredentialResolver {
  constructor(private readonly secretStore: SecretStore) {}

  async resolveCredential(connection_id: string): Promise<string> {
    return this.secretStore.resolveSecret(connection_id);
  }
}
