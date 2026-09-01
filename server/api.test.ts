import { describe, expect, test } from "bun:test";
import { openDatabase } from "../src/db/client";
import { createRepositories } from "../src/db/repositories";
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
});
