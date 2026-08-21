/**
 * @gptrouter/persistence
 *
 * Production persistence layer using Drizzle ORM with SQLite.
 * Swap to PostgreSQL by changing the driver and connection string.
 */

export * from './schema.js';
export * from './database.js';
export * from './prisma-client.js';
export * from './prisma-repositories.js';
export * from './production-composition.js';
export * from './converters.js';
export { createDatabaseRepositories } from './repositories.js';
export type { DatabaseRepositories } from './repositories.js';
export * from './credential-store.js';
export * from '@gptrouter/security/auth-verifier.js';
