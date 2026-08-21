import path from 'node:path';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  earlyAccess: true,
  schema: path.join(__dirname, 'prisma', 'schema.prisma'),
  datasource: {
    // Keep validation/generation deterministic without requiring a local
    // database. Deployment supplies the real PostgreSQL URL.
    url: process.env.DATABASE_URL ?? 'postgresql://postgres:test@localhost:5433/gptrouter_test',
  },
});
