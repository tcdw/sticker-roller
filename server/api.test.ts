import { describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { openDatabase } from "../src/db/client";
import { createRepositories } from "../src/db/repositories";
import { createServer } from "./index";
import { createApiHandler } from "./api";

const request = (method: string, path: string, value?: unknown) => new Request(`http://localhost${path}`, { method, headers: value === undefined ? undefined : { "content-type": "application/json" }, body: value === undefined ? undefined : JSON.stringify(value) });

describe("web API", () => {
  test("asset CRUD and validation use stable envelopes", async () => {
    const db = await openDatabase(":memory:"); const api = createApiHandler({ repositories: createRepositories(db.db) });
    expect((await api(request("GET", "/api/health"))).status).toBe(200);
    expect((await api(request("POST", "/api/assets", { name: "A", prompt: "hello" }))).status).toBe(201);
    expect((await api(request("POST", "/api/assets", { name: "B", prompt: "hello" }))).status).toBe(201);
    const invalid = await api(request("POST", "/api/jobs", { prompt: "x", count: 0 })); expect(invalid.status).toBe(400); expect(await invalid.json()).toHaveProperty("error.code", "INVALID_INPUT");
    db.close();
  });
  test("job persists across handler recreation and rejects reference images", async () => {
    const db = await openDatabase(":memory:"); const repo = createRepositories(db.db); const api = createApiHandler({ repositories: repo });
    const rejected = await api(request("POST", "/api/jobs", { prompt: "x", referenceImages: [] })); expect(rejected.status).toBe(400);
    const accepted = await api(request("POST", "/api/jobs", { prompt: "x", count: 1 })); expect(accepted.status).toBe(202); const job = await accepted.json() as { id: string };
    const api2 = createApiHandler({ repositories: repo }); expect((await api2(request("GET", `/api/jobs/${job.id}`))).status).toBe(200); db.close();
  });
  test("registered output blocks traversal and missing files", async () => {
    const db = await openDatabase(":memory:"); const repo = createRepositories(db.db); const api = createApiHandler({ repositories: repo, outputDir: "/tmp/sticker-output" });
    expect((await api(request("GET", "/api/output/..%2Fsecret.png"))).status).toBe(404);
    expect((await api(request("GET", "/api/output/nope.png"))).status).toBe(404); db.close();
  });
  test("accepted job is executed by a started worker", async () => {
    const outputDir = `/tmp/sticker-integration-${crypto.randomUUID()}`;
    const app = await createServer({ databasePath: ":memory:", outputDir, generator: async () => ({ success: true, imageBuffer: Buffer.from("fake"), mimeType: "image/png" }) });
    await app.worker.start();
    const accepted = await app.api(request("POST", "/api/jobs", { prompt: "integration" }));
    expect(accepted.status).toBe(202);
    const job = await accepted.json() as { id: string };
    await app.worker.drain();
    expect((await app.api(request("GET", `/api/jobs/${job.id}`))).json()).resolves.toHaveProperty("items.0.status", "succeeded");
    await app.worker.stop(); app.database.close(); await rm(outputDir, { recursive: true, force: true });
  });
});
