import { mkdir, rename } from "node:fs/promises";
import { join } from "node:path";
import type { Repositories } from "../db/repositories";
import { generateSingleImage, type SingleImageResult } from "../generator";
import type { StickerConfig } from "../config";

export type SingleImageGenerator = (input: {
  sticker: StickerConfig;
  model?: string;
  aspectRatio?: string;
  imageSize?: string;
  removeBackground?: boolean;
}) => Promise<SingleImageResult>;

export interface WorkerOptions {
  repositories: Repositories;
  generator?: SingleImageGenerator;
  outputDir?: string;
  heartbeatMs?: number;
  staleAfterMs?: number;
  maxAttempts?: number;
}

const safeError = (error: unknown) => error instanceof Error ? error.message.slice(0, 500) : "generation failed";
const extension = (mime: string) => mime === "image/jpeg" ? ".jpg" : mime === "image/webp" ? ".webp" : ".png";

export class GenerationWorker {
  private readonly repo: Repositories;
  private readonly generate: SingleImageGenerator;
  private readonly outputDir: string;
  private readonly heartbeatMs: number;
  private readonly maxAttempts: number;
  private stopped = false;
  private active?: Promise<void>;

  constructor(options: WorkerOptions) {
    this.repo = options.repositories;
    this.generate = options.generator ?? generateSingleImage;
    this.outputDir = options.outputDir ?? join(import.meta.dir, "../../output");
    this.heartbeatMs = options.heartbeatMs ?? 15_000;
    this.maxAttempts = options.maxAttempts ?? 3;
  }

  recover(): void {
    const before = new Date(Date.now() - (this.heartbeatMs * 2)).toISOString();
    this.repo.recoverStale(before);
  }

  async runOnce(): Promise<boolean> {
    if (this.stopped || this.active) return false;
    const item = this.repo.claimNextItem();
    if (!item) return false;
    this.active = this.process(item.id).finally(() => { this.active = undefined; });
    await this.active;
    return true;
  }

  async drain(): Promise<void> {
    while (await this.runOnce()) { /* queue is the source of truth */ }
  }

  start(): void {
    this.stopped = false;
    void this.drain();
  }

  stop(): void { this.stopped = true; }

  private async process(itemId: string): Promise<void> {
    const item = this.repo.getItem(itemId);
    if (!item) return;
    const job = this.repo.getJob(item.jobId).job;
    if (!job) return;
    const attempts = this.repo.listRequests(itemId);
    if (attempts.length >= this.maxAttempts) {
      this.repo.finishItem(itemId, "failed", "maximum attempts exceeded");
      return;
    }
    const request = this.repo.startRequest(itemId);
    const timer = setInterval(() => this.repo.updateHeartbeat(itemId), this.heartbeatMs);
    try {
      const options = JSON.parse(job.optionsSnapshot) as Record<string, unknown>;
      const result = await this.generate({
        sticker: { name: job.assetName, prompt: job.promptSnapshot, referenceImages: [] },
        model: typeof options.model === "string" ? options.model : undefined,
        aspectRatio: typeof options.aspectRatio === "string" ? options.aspectRatio : undefined,
        imageSize: typeof options.imageSize === "string" ? options.imageSize : undefined,
        removeBackground: typeof options.removeBackground === "boolean" ? options.removeBackground : undefined,
      });
      if (!result.success || !result.imageBuffer) throw new Error(result.error ?? "generator returned no image");
      await mkdir(this.outputDir, { recursive: true });
      const fileName = `${item.jobId}-${item.ordinal}${extension(result.mimeType ?? "image/png")}`;
      const finalPath = join(this.outputDir, fileName);
      const tempPath = `${finalPath}.${item.id}.tmp`;
      await Bun.write(tempPath, result.imageBuffer);
      await rename(tempPath, finalPath);
      this.repo.finishRequest(request.id, "succeeded");
      const existing = this.repo.getFileByItem(itemId);
      if (!existing.some((file) => file.fileName === fileName)) {
        this.repo.registerFile({ itemId, fileName, mimeType: result.mimeType ?? "image/png", sizeBytes: result.imageBuffer.byteLength });
      }
      this.repo.finishItem(itemId, "succeeded");
    } catch (error) {
      this.repo.finishRequest(request.id, "failed", safeError(error));
      this.repo.finishItem(itemId, "failed", safeError(error));
    } finally {
      clearInterval(timer);
    }
  }
}

export function createWorker(options: WorkerOptions): GenerationWorker { return new GenerationWorker(options); }
