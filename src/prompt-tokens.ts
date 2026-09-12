/**
 * 纯 TS 的 prompt 引用 token 解析，前后端共享。
 *
 * 注意：本文件不得引入 node:fs / node:path 等 node 专属依赖，
 * web 前端与 CLI 都会直接使用本文件。
 */

export const ASSET_TOKEN = /@\[([^\]]+)\]\(asset:([^)]+)\)/g;
export const IMAGE_TOKEN = /!\[([^\]]+)\]\(image:([^)]+)\)/g;

/** Stable asset IDs referenced by the prompt, ignoring tokens the library does not know. */
export function referencedIdsFromPrompt(prompt: string, assets: ReadonlyArray<{ id: string }>): string[] {
  const known = new Set(assets.map((asset) => asset.id));
  return [
    ...new Set(
      Array.from(prompt.matchAll(ASSET_TOKEN), (match) => match[2]).filter((id): id is string =>
        Boolean(id && known.has(id)),
      ),
    ),
  ];
}

/** Stable upload IDs referenced by the prompt, ignoring tokens the library does not know. */
export function referencedImageIdsFromPrompt(prompt: string, uploads: ReadonlyArray<{ id: string }>): string[] {
  const known = new Set(uploads.map((upload) => upload.id));
  return [
    ...new Set(
      Array.from(prompt.matchAll(IMAGE_TOKEN), (match) => match[2]).filter((id): id is string =>
        Boolean(id && known.has(id)),
      ),
    ),
  ];
}

/** Uploaded images the current prompt does not reference, so the next job would silently skip them. */
export function unreferencedUploads<T extends { id: string }>(prompt: string, uploads: readonly T[]): T[] {
  const referenced = new Set(referencedImageIdsFromPrompt(prompt, uploads));
  return uploads.filter((upload) => !referenced.has(upload.id));
}
