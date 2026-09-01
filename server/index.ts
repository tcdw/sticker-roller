import { join, resolve } from "node:path";
import { openDatabase } from "../src/db/client";
import { createRepositories } from "../src/db/repositories";
import { createWorker, startGenerationWorker, stopGenerationWorker } from "../src/jobs";
import { createApiHandler } from "./api";

type ServerOptions = { databasePath?: string; outputDir?: string; generator?: Parameters<typeof createWorker>[0]["generator"]; hostname?: string; port?: number };

export async function createServer(options: ServerOptions = {}) {
  const database = await openDatabase(options.databasePath);
  const repositories = createRepositories(database.db);
  const outputDir = options.outputDir ?? process.env.OUTPUT_DIR;
  const worker = createWorker({ repositories, outputDir, generator: options.generator });
  const api = createApiHandler({ repositories, outputDir });
  return { database, repositories, worker, api };
}

async function staticResponse(dist: string, pathname: string): Promise<Response> {
  let decoded: string;
  try { decoded = decodeURIComponent(pathname); } catch { return new Response("not found", { status: 404 }); }
  if (decoded.includes("\0")) return new Response("not found", { status: 404 });
  const requested = decoded === "/" ? "/index.html" : decoded;
  const distRoot = resolve(dist);
  const target = resolve(distRoot, `.${requested}`);
  const inDist = target === distRoot || target.startsWith(`${distRoot}/`);
  if (inDist) {
    const file = Bun.file(target);
    if (await file.exists()) return new Response(file);
  }
  // SPA fallback is restricted to extensionless frontend routes, not asset typos.
  if (requested === "/" || !requested.split("/").at(-1)?.includes(".")) {
    const fallback = Bun.file(resolve(distRoot, "index.html"));
    if (await fallback.exists()) return new Response(fallback);
  }
  return new Response("not found", { status: 404, headers: { "content-type": "text/plain" } });
}

export async function startServer(options: ServerOptions = {}) {
  const app = await createServer(options);
  // Recovery is awaited; the loop is deliberately launched but not awaited.
  await startGenerationWorker(app.worker);
  const dist = resolve(import.meta.dir, "../dist");
  const server = Bun.serve({
    hostname: options.hostname ?? process.env.HOST ?? "127.0.0.1",
    port: options.port ?? Number(process.env.PORT ?? 3000),
    async fetch(req) {
      const apiResponse = await app.api(req);
      if (new URL(req.url).pathname.startsWith("/api/") || apiResponse.status !== 404) return apiResponse;
      return staticResponse(dist, new URL(req.url).pathname);
    },
  });
  let shuttingDown: Promise<void> | undefined;
  const shutdown = () => {
    shuttingDown ??= (async () => { await stopGenerationWorker(app.worker); server.stop(); app.database.close(); })();
    return shuttingDown;
  };
  process.once("SIGINT", shutdown); process.once("SIGTERM", shutdown);
  console.log(`Sticker Roller listening on http://${server.hostname}:${server.port}`);
  return { ...app, server, shutdown };
}

if (import.meta.main) await startServer();
