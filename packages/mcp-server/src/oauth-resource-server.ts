import {
  getOAuthProtectedResourceMetadataUrl,
  oauthMetadataResponse,
  requireBearerAuth,
  type McpHttpHandler,
  type OAuthMetadata,
  type OAuthTokenVerifier,
} from '@modelcontextprotocol/server';

export interface OAuthResourceServerOptions {
  verifier: OAuthTokenVerifier;
  oauthMetadata: OAuthMetadata;
  resourceServerUrl: URL;
  requiredScopes?: string[];
}

/**
 * Wrap the canonical MCP handler with the MCP OAuth resource-server boundary.
 *
 * The wrapper deliberately does not issue tokens. It publishes RFC 9728
 * protected-resource metadata, validates bearer access tokens through the
 * injected verifier, and forwards only verified AuthInfo into the MCP handler.
 */
export function createOAuthProtectedMcpHandler(
  handler: McpHttpHandler,
  options: OAuthResourceServerOptions
): McpHttpHandler {
  const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(options.resourceServerUrl);
  const gate = requireBearerAuth({
    verifier: options.verifier,
    requiredScopes: options.requiredScopes ?? ['mcp'],
    resourceMetadataUrl,
  });
  const mcpPath = options.resourceServerUrl.pathname;

  return {
    ...handler,
    async fetch(request, requestOptions) {
      const metadata = oauthMetadataResponse(request, {
        oauthMetadata: options.oauthMetadata,
        resourceServerUrl: options.resourceServerUrl,
      });
      if (metadata) return metadata;

      const url = new URL(request.url);
      if (url.pathname !== mcpPath) {
        return Response.json({ error: 'not_found' }, { status: 404 });
      }

      const authInfo = await gate(request);
      if (authInfo instanceof Response) return authInfo;

      return handler.fetch(request, {
        ...requestOptions,
        authInfo,
      });
    },
  };
}
