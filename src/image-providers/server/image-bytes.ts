/**
 * 生成结果的字节校验：只信字节，不信上游声明的 media type。
 *
 * 为什么必须在这里做（定案 §11 验收 + 阶段四协议复核）：
 * - 上游可能返回 SVG、HTML 错误页或截断数据，而 worker 是按 mime 决定扩展名的，
 *   不校验就会把非图片写成 .png 并登记成正常产物；
 * - `Buffer.from(s, 'base64')` 会静默忽略非法字符，所以 base64 也要严格解码；
 * - 原生透明必须真的带 alpha，验不过就失败，绝不回落洋红抠底。
 */

import sharp from 'sharp';
import { sniffImageMimeType } from '../../uploads';

/** 防御性上限：异常大的响应不写进 output/。单张贴纸远小于这个量级。 */
export const MAX_IMAGE_BYTES = 64 * 1024 * 1024;

const BASE64 = /^[A-Za-z0-9+/\r\n]+={0,2}$/;

/** 严格 base64 解码：先查字符集，再解码，避免非法字符被静默丢弃后当成图片。 */
export function decodeBase64Strict(value: unknown, what: string): Buffer {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${what} is missing from the provider response`);
  }
  if (!BASE64.test(value)) {
    throw new Error(`${what} is not valid base64`);
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64').replace(/=+$/, '') !== value.replace(/[\r\n]/g, '').replace(/=+$/, '')) {
    throw new Error(`${what} is not valid base64`);
  }
  return bytes;
}

export interface VerifiedImage {
  readonly bytes: Buffer;
  /** 嗅探结果，权威值；与上游声明不一致时以它为准。 */
  readonly mimeType: string;
  readonly hasAlpha: boolean;
}

/**
 * 校验一段图片字节：非空、不超限、是 PNG/JPEG/WebP、且能被解码出尺寸。
 * 返回的 mimeType 一定与字节一致，调用方可以直接拿去登记。
 */
export async function verifyImageBytes(bytes: Buffer): Promise<VerifiedImage> {
  if (!bytes.byteLength) {
    throw new Error('provider returned an empty image');
  }
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new Error('provider returned an image larger than the supported limit');
  }
  const mimeType = sniffImageMimeType(bytes);
  if (!mimeType) {
    // SVG / GIF / HTML 错误页都落在这里：栅格输出链路不接受它们。
    throw new Error('provider returned an unsupported image format');
  }
  let metadata: Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>;
  try {
    metadata = await sharp(bytes, { limitInputPixels: 40_000_000 }).metadata();
    await sharp(bytes, { limitInputPixels: 40_000_000 }).raw().toBuffer();
  } catch {
    throw new Error('provider returned an image that could not be decoded');
  }
  if (!metadata.width || !metadata.height) {
    throw new Error('provider returned an image that could not be decoded');
  }
  return { bytes, mimeType, hasAlpha: metadata.hasAlpha === true };
}
