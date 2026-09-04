import { Database } from 'bun:sqlite';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import * as schema from './schema';

export type Db = ReturnType<typeof drizzle<typeof schema>>;
export interface DatabaseHandle {
  db: Db;
  sqlite: Database;
  close(): void;
}
export async function openDatabase(
  path = process.env.DATABASE_PATH ?? './data/sticker-roller.sqlite',
): Promise<DatabaseHandle> {
  if (path !== ':memory:') {
    await mkdir(dirname(path), { recursive: true });
  }
  const sqlite = new Database(path);
  sqlite.run('PRAGMA foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  // URL.pathname keeps a leading slash on Windows, so convert to a real path.
  migrate(db, { migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)) });
  return { db, sqlite, close: () => sqlite.close() };
}
export function nowUtc(): string {
  return new Date().toISOString();
}
export { schema };
