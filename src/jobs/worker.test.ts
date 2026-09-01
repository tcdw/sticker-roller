import { describe, expect, test } from "bun:test";
import { openDatabase } from "../db/client";
import { createRepositories } from "../db/repositories";
import { createWorker } from "./worker";

describe("durable generation worker", () => {
  test("persists each item and does not rerun successful items on retry", async () => {
    const db = await openDatabase(":memory:"); const repo = createRepositories(db.db); let calls = 0;
    const job = repo.createJob({ assetName: "demo", prompt: "p", options: {}, count: 2 });
    const worker = createWorker({ repositories: repo, outputDir: `/tmp/sticker-worker-${crypto.randomUUID()}`, generator: async () => { calls++; return calls === 2 ? { success: false, error: "nope" } : { success: true, imageBuffer: Buffer.from("png"), mimeType: "image/png" }; } });
    await worker.drain();
    expect(repo.getJob(job.id).items.map((item) => item.status)).toEqual(["succeeded", "failed"]);
    expect(calls).toBe(2);
    repo.retryFailed(job.id); await worker.drain();
    expect(calls).toBe(3); expect(repo.getJob(job.id).items.map((item) => item.status)).toEqual(["succeeded", "succeeded"]);
    db.close();
  });

  test("queued cancellation is honored", async () => {
    const db = await openDatabase(":memory:"); const repo = createRepositories(db.db); const job = repo.createJob({ assetName: "x", prompt: "p", options: {}, count: 2 });
    repo.cancelJob(job.id); let calls = 0;
    await createWorker({ repositories: repo, generator: async () => { calls++; return { success: true, imageBuffer: Buffer.from("x"), mimeType: "image/png" }; } }).drain();
    expect(calls).toBe(0); expect(repo.getJob(job.id).items.every((item) => item.status === "cancelled")).toBe(true); db.close();
  });

  test("stale recovery is idempotent for registered output", async () => {
    const db = await openDatabase(":memory:"); const repo = createRepositories(db.db); const job = repo.createJob({ assetName: "x", prompt: "p", options: {}, count: 1 }); const item = repo.claimNextItem()!;
    repo.registerFile({ itemId: item.id, fileName: `${job.id}-1.png`, mimeType: "image/png", sizeBytes: 1 });
    repo.recoverStale(new Date(Date.now() + 1000).toISOString()); repo.recoverStale(new Date(Date.now() + 1000).toISOString());
    expect(repo.getFileByItem(item.id)).toHaveLength(1); expect(repo.getJob(job.id).items[0]?.status).toBe("queued"); db.close();
  });
});
