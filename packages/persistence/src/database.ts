import SqliteBetter3 from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export type DrizzleDB = ReturnType<typeof drizzle<typeof schema>>;

export interface DatabaseOptions {
  url?: string;
}

export function createDatabase(options: DatabaseOptions = {}): {
  db: DrizzleDB;
  sqlite: InstanceType<typeof SqliteBetter3>;
} {
  const url = options.url ?? ':memory:';
  const sqlite = new SqliteBetter3(url);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}

export function createTestDatabase(): {
  db: DrizzleDB;
  sqlite: InstanceType<typeof SqliteBetter3>;
} {
  return createDatabase({ url: ':memory:' });
}

export function initializeSchema(sqlite: InstanceType<typeof SqliteBetter3>): void {
  const sqlPath = resolve(__dirname, '../drizzle/0000_init.sql');
  const sql = readFileSync(sqlPath, 'utf-8');
  sqlite.exec(sql);
}
