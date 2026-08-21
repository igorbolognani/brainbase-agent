/**
 * @gptrouter/provider-runtime
 *
 * Runtime wiring: credential resolution, trusted provider endpoints,
 * and adapter re-exports for package boundary clarity.
 */

export * from './credential-resolver.js';
export * from './openai-adapter.js';
export * from './gemini-adapter.js';
export * from './provider-endpoint-registry.js';
export * from './gateway-adapter.js';
