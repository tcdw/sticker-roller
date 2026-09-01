import { openDatabase } from "../src/db/client";
import { createRepositories } from "../src/db/repositories";
import { createWorker, startGenerationWorker, stopGenerationWorker } from "../src/jobs";
import { createApiHandler } from "./api";
import { join } from "node:path";

export async function createServer(options: { databasePath?: string; outputDir?: string; generator?: Parameters<typeof createWorker>[0]["generator"] } = {}) {
  const database = await openDatabase(options.databasePath);
  const repositories = createRepositories(database.db);
  const outputDir = options.outputDir ?? process.env.OUTPUT_DIR;
  const worker = createWorker({ repositories, outputDir, generator: options.generator });
  const api = createApiHandler({ repositories, outputDir });
  return { database, repositories, worker, api };
}

export async function startServer() {
  const app = await createServer();
  void startGenerationWorker(app.worker);
  const dist = join(import.meta.dir, "../dist");
  const server = Bun.serve({
    hostname: process.env.HOST ?? "127.0.0.1",
    port: Number(process.env.PORT ?? 3000),
    async fetch(req) {
      const apiResponse = await app.api(req);
      if (new URL(req.url).pathname.startsWith("/api/") || apiResponse.status !== 404) return apiResponse;
      const url = new URL(req.url);
      const requested = url.pathname === "/" ? "/index.html" : url.pathname;
      const file = Bun.file(join(dist, requested));
      if (await file.exists()) return new Response(file);
      const fallback = Bun.file(join(dist, "index.html"));
      return await fallback.exists() ? new Response(fallback) : new Response("Sticker Roller server is ready", { headers: { "content-type": "text/plain" } });
    },
  });
  const shutdown = () => { stopGenerationWorker(app.worker); app.database.close(); server.stop(); };
  process.once("SIGINT", shutdown); process.once("SIGTERM", shutdown);
  console.log(`Sticker Roller listening on http://${server.hostname}:${server.port}`);
  return { ...app, server };
}

if (import.meta.main) await startServer();
