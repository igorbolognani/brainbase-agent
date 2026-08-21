import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

export interface PrismaClientOptions {
  connectionString?: string;
  log?: Array<'query' | 'info' | 'warn' | 'error'>;
}

/** Create the production PostgreSQL client. No credentials are logged. */
export function createPrismaClient(options: PrismaClientOptions = {}): PrismaClient {
  const connectionString = options.connectionString ?? process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required for Prisma PostgreSQL runtime');
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter, log: options.log });
}

export type PrismaDatabase = PrismaClient;
