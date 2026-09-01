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
    repo.recoverStale(new Date(Date.now()+1000).toISOString()); expect(repo.getJob(job!.id).items[0]?.status).toBe("queued"); expect(item.id).toBeTruthy(); handle.close();
  });
});
