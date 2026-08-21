export interface ProviderEndpoint {
  provider: string;
  baseUrl: string;
  auth_method: 'api_key_header' | 'bearer';
}

export const TRUSTED_PROVIDER_ENDPOINTS: ProviderEndpoint[] = [
  {
    provider: 'google',
    baseUrl: 'https://generativelanguage.googleapis.com',
    auth_method: 'api_key_header',
  },
  { provider: 'openrouter', baseUrl: 'https://openrouter.ai/api', auth_method: 'bearer' },
  { provider: 'deepseek', baseUrl: 'https://api.deepseek.com', auth_method: 'bearer' },
];

export function getTrustedEndpoint(provider: string): ProviderEndpoint | null {
  return TRUSTED_PROVIDER_ENDPOINTS.find((e) => e.provider === provider) ?? null;
}
