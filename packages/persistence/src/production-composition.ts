/**
 * Production persistence composition.
 *
 * Owns the PrismaClient lifecycle and provides Prisma repositories
 * for production use. Dependency-injected: no global singletons.
 */

import type { PrismaClient } from '@prisma/client';
import type {
  AccountRepository,
  MembershipRepository,
  ConnectionRepository,
  RouteRepository,
  PolicyRepository,
  TaskRepository,
  DecisionRepository,
  ExecutionRepository,
  UsageRepository,
  AuditRepository,
  PrincipalRepository,
} from '@gptrouter/contracts';
import {
  PrismaPrincipalRepository,
  PrismaAccountRepository,
  PrismaMembershipRepository,
  PrismaConnectionRepository,
  PrismaRouteRepository,
  PrismaPolicyRepository,
  PrismaTaskRepository,
  PrismaDecisionRepository,
  PrismaExecutionRepository,
  PrismaUsageRepository,
  PrismaAuditRepository,
} from './prisma-repositories.js';
import { createPrismaClient } from './prisma-client.js';

export interface ProductionPersistence {
  prisma: PrismaClient;
  repositories: {
    principals: PrincipalRepository;
    accounts: AccountRepository;
    memberships: MembershipRepository;
    connections: ConnectionRepository;
    routes: RouteRepository;
    policies: PolicyRepository;
    tasks: TaskRepository;
    decisions: DecisionRepository;
    executions: ExecutionRepository;
    usage: UsageRepository;
    audit: AuditRepository;
  };
  disconnect(): Promise<void>;
}

export interface ProductionPersistenceOptions {
  connectionString?: string;
  log?: Array<'query' | 'info' | 'warn' | 'error'>;
}

/**
 * Create a production persistence layer with Prisma/PostgreSQL.
 *
 * Usage:
 * ```ts
 * const persistence = await createProductionPersistence({ connectionString });
 * const app = createProductionGPTRouterApplication({
 *   repositories: persistence.repositories,
 *   ...
 * });
 * // ... use app
 * await persistence.disconnect();
 * ```
 */
export function createProductionPersistence(
  options: ProductionPersistenceOptions = {}
): ProductionPersistence {
  const prisma = createPrismaClient(options);

  const repositories = {
    principals: new PrismaPrincipalRepository(prisma),
    accounts: new PrismaAccountRepository(prisma),
    memberships: new PrismaMembershipRepository(prisma),
    connections: new PrismaConnectionRepository(prisma),
    routes: new PrismaRouteRepository(prisma),
    policies: new PrismaPolicyRepository(prisma),
    tasks: new PrismaTaskRepository(prisma),
    decisions: new PrismaDecisionRepository(prisma),
    executions: new PrismaExecutionRepository(prisma),
    usage: new PrismaUsageRepository(prisma),
    audit: new PrismaAuditRepository(prisma),
  };

  return {
    prisma,
    repositories,
    async disconnect() {
      await prisma.$disconnect();
    },
  };
}
