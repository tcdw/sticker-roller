/**
 * 生成请求的输入形状与背景抠图常量。
 *
 * 提示词与参考图不再来自 stickers/ 文件夹：素材统一存在 SQLite 的 assets/uploads，
 * 由 web 与 CLI 共用（见 src/jobs/references.ts）。
 */

export interface ReferenceImage {
  data: string; // base64
  mimeType: string;
  fileName: string;
}

export interface StickerConfig {
  name: string;
  prompt: string;
  referenceImages: ReferenceImage[]; // 支持多张参考图，按调用方给定的顺序
  aspectRatio?: string;
  imageSize?: string;
  removeBackground?: boolean;
}

export { DEFAULT_MODEL, SUPPORTED_MODELS } from './image-options';
export const DEFAULT_REMOVE_BACKGROUND = true;

export const BACKGROUND_KEY_COLOR = '#FF00FF';
