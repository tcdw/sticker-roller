import { describe, expect, test } from "bun:test";
import { openDatabase } from "./client";
import { createRepositories } from "./repositories";
import { unlink } from "node:fs/promises";

describe("sqlite data layer", () => {
  test("migrates, persists, snapshots, and transitions", async () => {
    const path = `/tmp/sticker-roller-${crypto.randomUUID()}.sqlite`;
    const first = await openDatabase(path); const repo = createRepositories(first.db);
    const asset = repo.createAsset({name:"demo",prompt:"hello"});
    const job = repo.createJob({assetId:asset.id,assetName:asset.name,prompt:asset.prompt,options:{count:2},count:2});
    expect(job?.promptSnapshot).toBe("hello");
    const item = repo.claimNextItem()!; const request = repo.startRequest(item.id);
    repo.finishRequest(request.id,"succeeded"); repo.registerFile({itemId:item.id,fileName:"safe.png",mimeType:"image/png",sizeBytes:10}); repo.finishItem(item.id,"succeeded");
    const failed = repo.claimNextItem()!; repo.finishItem(failed.id,"failed","oops");
    expect(repo.getJob(job!.id).job?.completedCount).toBe(1); expect(repo.getJob(job!.id).job?.failedCount).toBe(1);
    repo.retryFailed(job!.id); expect(repo.claimNextItem()!.id).toBe(failed.id);
    first.close(); const second = await openDatabase(path); expect(createRepositories(second.db).getAsset(asset.id)?.prompt).toBe("hello"); second.close(); await unlink(path); await unlink(`${path}-wal`).catch(()=>{}); await unlink(`${path}-shm`).catch(()=>{});
  });

  test("recovers stale running work", async () => {
    const handle = await openDatabase(":memory:"); const repo = createRepositories(handle.db);
    const job = repo.createJob({assetName:"x",prompt:"p",options:{},count:1}); const item=repo.claimNextItem()!;
    const request = repo.startRequest(item.id);
    const recovered = repo.recoverStale(new Date(Date.now()+1000).toISOString());
    expect(recovered.items[0]?.id).toBe(item.id);
    expect(recovered.requests[0]?.id).toBe(request.id);
    expect(repo.getJob(job!.id).items[0]?.status).toBe("queued");
    expect(repo.getJob(job!.id).job?.status).toBe("queued");
    expect(repo.getJob(job!.id).events.map((event) => event.type)).toEqual(["job.created", "item.claimed", "request.recovered", "item.recovered"]);
    handle.close();
  });

  test("derives terminal job status and protects transitions", async () => {
    const handle = await openDatabase(":memory:"); const repo = createRepositories(handle.db);
    const job = repo.createJob({assetName:"x",prompt:"p",options:{},count:2})!;
    const queued = repo.getJob(job.id).items[0]!; expect(() => repo.startRequest(queued.id)).toThrow("running item");
    const first = repo.claimNextItem()!;
    const request = repo.startRequest(first.id); repo.finishRequest(request.id, "succeeded"); repo.finishItem(first.id, "succeeded");
    expect(repo.getJob(job.id).job?.status).toBe("queued");
    const second = repo.claimNextItem()!; repo.finishItem(second.id, "failed", "nope");
    expect(repo.getJob(job.id).job?.status).toBe("failed");
    expect(() => repo.finishItem(second.id, "succeeded")).toThrow("running item");
    expect(() => repo.finishRequest(request.id, "failed")).toThrow("running request");
    handle.close();
  });

  test("cancellation closes the claimed item start window", async () => {
    const handle = await openDatabase(":memory:"); const repo = createRepositories(handle.db);
    const job = repo.createJob({ assetName:"x", prompt:"p", options:{}, count:1 }); const item = repo.claimNextItem()!;
    repo.cancelJob(job.id);
    expect(repo.getJob(job.id).items[0]?.status).toBe("cancelled");
    expect(() => repo.startRequest(item.id)).toThrow("cancelled");
    expect(repo.listRequests(item.id)).toHaveLength(0); handle.close();
  });

  test("looks up registered files by name, item, and id", async () => {
    const handle = await openDatabase(":memory:"); const repo = createRepositories(handle.db);
    const job = repo.createJob({assetName:"x",prompt:"p",options:{},count:1})!; const item = repo.claimNextItem()!;
    const file = repo.registerFile({itemId:item.id,fileName:"safe.png",mimeType:"image/png",sizeBytes:10});
    expect(repo.getFile(file.id)?.itemId).toBe(item.id);
    expect(repo.getFileByName("safe.png")[0]?.id).toBe(file.id);
    expect(repo.getFileByItem(item.id)[0]?.fileName).toBe("safe.png");
    expect(repo.getFileByJob(job.id)[0]?.file.id).toBe(file.id);
    expect(repo.getFileByNameAndJob("safe.png", job.id)[0]?.file.id).toBe(file.id);
    expect(() => repo.registerFile({itemId:item.id,fileName:"../escape",mimeType:"x",sizeBytes:0})).toThrow("invalid");
    void job; handle.close();
  });
});
