import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import * as schema from "./schema";

export type Db = ReturnType<typeof drizzle<typeof schema>>;
export interface DatabaseHandle { db: Db; sqlite: Database; close(): void; }
export async function openDatabase(path = process.env.DATABASE_PATH ?? "./data/sticker-roller.sqlite"): Promise<DatabaseHandle> {
  if (path !== ":memory:") await mkdir(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.run("PRAGMA foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: new URL("../../drizzle", import.meta.url).pathname });
  return { db, sqlite, close: () => sqlite.close() };
}
export function nowUtc(): string { return new Date().toISOString(); }
export { schema };
