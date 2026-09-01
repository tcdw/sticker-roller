import { mkdir, rename, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { Repositories } from '../db/repositories';
import { generateSingleImage, type SingleImageResult } from '../generator';
import type { StickerConfig } from '../config';

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

const safeError = (error: unknown) => {
  const message = error instanceof Error ? error.message : 'generation failed';
  return (
    message
      .replace(/https?:\/\/[^\s]+/gi, '[provider url]')
      // Replace the complete value, not just the header name. This covers the
      // standard Bearer/Basic forms as well as provider-specific credentials.
      .replace(
        /(?:authorization|www-authenticate|x-api-key|api-key|token|secret|cookie)\s*[:=]\s*[^\r\n,;]+/gi,
        '[sensitive value redacted]',
      )
      .replace(/\b(?:bearer|basic)\s+[^\s,;]+/gi, '[sensitive value redacted]')
      .slice(0, 500)
  );
};
const extension = (mime: string) => (mime === 'image/jpeg' ? '.jpg' : mime === 'image/webp' ? '.webp' : '.png');

export class GenerationWorker {
  private readonly repo: Repositories;
  private readonly generate: SingleImageGenerator;
  private readonly outputDir: string;
  private readonly heartbeatMs: number;
  private readonly staleAfterMs: number;
  private readonly maxAttempts: number;
  private stopped = false;
  private active?: Promise<void>;
  private loop?: Promise<void>;
  constructor(options: WorkerOptions) {
    this.repo = options.repositories;
    this.generate = options.generator ?? generateSingleImage;
    this.outputDir = options.outputDir ?? join(import.meta.dir, '../../output');
    this.heartbeatMs = options.heartbeatMs ?? 15_000;
    this.staleAfterMs = options.staleAfterMs ?? this.heartbeatMs * 2;
    this.maxAttempts = options.maxAttempts ?? 3;
  }
  recover(): void {
    this.repo.recoverStale(new Date(Date.now() - this.staleAfterMs).toISOString());
  }
  async runOnce(): Promise<boolean> {
    if (this.stopped || this.active) return false;
    const item = this.repo.claimNextItem();
    if (!item) return false;
    this.active = this.process(item.id).finally(() => {
      this.active = undefined;
    });
    await this.active;
    return true;
  }
  async drain(): Promise<void> {
    while (await this.runOnce()) {}
  }
  private async runLoop(): Promise<void> {
    while (!this.stopped) {
      if (!(await this.runOnce())) await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  /** Bun server lifecycle hook: recovery completes before this resolves; drain continues in background. */
  start(): Promise<void> {
    this.stopped = false;
    this.recover();
    this.loop ??= this.runLoop()
      .catch((error) => {
        console.error('generation worker stopped unexpectedly', error);
      })
      .finally(() => {
        this.loop = undefined;
      });
    return Promise.resolve();
  }
  /** Stop accepting work and wait for the active provider call and drain loop. */
  async stop(): Promise<void> {
    this.stopped = true;
    await this.active;
    await this.loop;
  }

  private async process(itemId: string): Promise<void> {
    const item = this.repo.getItem(itemId);
    if (!item) return;
    const job = this.repo.getJob(item.jobId).job;
    if (!job) return;
    const registered = this.repo
      .getFileByItem(itemId)
      .find(
        (file) => file.fileName.endsWith('.png') || file.fileName.endsWith('.jpg') || file.fileName.endsWith('.webp'),
      );
    if (registered) {
      try {
        await stat(join(this.outputDir, registered.fileName));
        this.repo.completeRegisteredItem(itemId, registered.fileName);
        return;
      } catch {}
    }
    const attempts = this.repo.listRequests(itemId);
    if (attempts.length >= this.maxAttempts) {
      this.repo.finishItem(itemId, 'failed', 'maximum attempts exceeded');
      return;
    }
    let request;
    try {
      request = this.repo.startRequest(itemId);
    } catch (error) {
      // Cancellation may win the claim-to-call boundary. In that case no
      // provider request was created, so leave the cancelled item terminal.
      if (error instanceof Error && error.message.includes('cancelled')) return;
      throw error;
    }
    const timer = setInterval(() => this.repo.updateHeartbeat(itemId), this.heartbeatMs);
    let finalPath: string | undefined;
    let tempPath: string | undefined;
    try {
      const options = JSON.parse(job.optionsSnapshot) as Record<string, unknown>;
      const result = await this.generate({
        sticker: { name: job.assetName, prompt: job.promptSnapshot, referenceImages: [] },
        model: typeof options.model === 'string' ? options.model : undefined,
        aspectRatio: typeof options.aspectRatio === 'string' ? options.aspectRatio : undefined,
        imageSize: typeof options.imageSize === 'string' ? options.imageSize : undefined,
        removeBackground: typeof options.removeBackground === 'boolean' ? options.removeBackground : undefined,
      });
      if (!result.success || !result.imageBuffer) throw new Error(result.error ?? 'generator returned no image');
      await mkdir(this.outputDir, { recursive: true });
      const mimeType = result.mimeType ?? 'image/png';
      const actualName = `${item.jobId}-${item.ordinal}${extension(mimeType)}`;
      finalPath = join(this.outputDir, actualName);
      tempPath = `${finalPath}.${item.id}.tmp`;
      await Bun.write(tempPath, result.imageBuffer);
      await rename(tempPath, finalPath);
      tempPath = undefined;
      this.repo.finalizeRequest({
        requestId: request.id,
        itemId,
        status: 'succeeded',
        file: { fileName: actualName, mimeType, sizeBytes: result.imageBuffer.byteLength },
      });
    } catch (error) {
      if (tempPath) await unlink(tempPath).catch(() => {});
      this.repo.finalizeRequest({ requestId: request.id, itemId, status: 'failed', error: safeError(error) });
    } finally {
      clearInterval(timer);
    }
  }
}
export function createWorker(options: WorkerOptions): GenerationWorker {
  return new GenerationWorker(options);
}
/** Application integration contract for Bun: initialize repositories, await worker.start(), then listen; await worker.stop() during shutdown. */
export function startGenerationWorker(worker: GenerationWorker): Promise<void> {
  return worker.start();
}
export function stopGenerationWorker(worker: GenerationWorker): Promise<void> {
  return worker.stop();
}
