/**
 * 查询子命令的纯逻辑层：取数 + 渲染。argv 解析与进程 IO 都不在这里，方便直接断言输出。
 *
 * 数据形状与 web API 保持一致：asset 的 metadata 是对象（和 /api/assets 一样），
 * upload 永远不包含 base64 字段。
 */

import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { Repositories } from './db/repositories';
import type { AssetRow, UploadRow, UploadSummary } from './db/schema';
import { resolveAssetRef, resolveUploadRef } from './jobs/references';

export interface ListAssetsQuery {
  search?: string;
  category?: string;
  includeArchived?: boolean;
}

export interface ListUploadsQuery {
  search?: string;
  includeArchived?: boolean;
}

/** Public JSON shape of an asset, matching what /api/assets returns. */
export type PublicAsset = Omit<AssetRow, 'metadata'> & { metadata: Record<string, unknown> };

const parseMetadata = (value: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

export const publicAsset = (asset: AssetRow): PublicAsset => ({
  ...asset,
  metadata: parseMetadata(asset.metadata),
});

export function listAssets(repo: Repositories, query: ListAssetsQuery = {}): PublicAsset[] {
  const needle = query.search?.trim().toLowerCase();
  const category = query.category?.trim().toLowerCase();
  return repo
    .listAssets(query.includeArchived === true)
    .filter((asset) => !needle || asset.name.toLowerCase().includes(needle))
    .filter((asset) => !category || (asset.category ?? '').toLowerCase() === category)
    .map(publicAsset);
}

export function showAsset(repo: Repositories, ref: string): PublicAsset {
  return publicAsset(resolveAssetRef(repo, ref, { allowNames: true }));
}

export function listUploads(repo: Repositories, query: ListUploadsQuery = {}): UploadSummary[] {
  const needle = query.search?.trim().toLowerCase();
  return repo
    .listUploads(query.includeArchived === true)
    .filter((upload) => !needle || upload.name.toLowerCase().includes(needle));
}

export function showUpload(repo: Repositories, ref: string): UploadRow {
  return resolveUploadRef(repo, ref, { allowNames: true });
}

/** Write the stored bytes to disk and return the absolute path, mirroring what `generate` prints. */
export async function writeUploadTo(upload: UploadRow, outPath: string): Promise<string> {
  const target = resolve(outPath);
  await mkdir(dirname(target), { recursive: true });
  await Bun.write(target, Buffer.from(upload.data, 'base64'));
  return target;
}

/** Upload metadata without the base64 payload, so listings stay cheap and never leak bytes. */
export function uploadSummary(upload: UploadRow): UploadSummary {
  const { data: _data, ...summary } = upload;
  return summary;
}

const collapse = (value: string) => value.replace(/\s+/g, ' ').trim();

function truncate(value: string, width: number): string {
  const text = collapse(value);
  return text.length > width ? `${text.slice(0, Math.max(1, width - 1))}…` : text;
}

const day = (iso: string) => iso.slice(0, 10);
const stamp = (iso: string) => `${iso.slice(0, 19)}Z`;

function padColumns(rows: string[][], headers: string[], maxWidths: number[]): string[] {
  const widths = headers.map((header, index) =>
    Math.min(
      maxWidths[index] ?? Number.POSITIVE_INFINITY,
      Math.max(header.length, ...rows.map((row) => row[index]!.length)),
    ),
  );
  const line = (cells: string[]) =>
    cells
      .map((cell, index) => (index === cells.length - 1 ? truncate(cell, 240) : cell.padEnd(widths[index]!)))
      .join('  ')
      .trimEnd();
  return [line(headers), ...rows.map(line)];
}

export function renderAssetTable(assets: readonly PublicAsset[]): string {
  const rows = assets.map((asset) => [
    asset.id,
    truncate(asset.name, 24),
    truncate(asset.category ?? '-', 16),
    day(asset.updatedAt),
    asset.archivedAt ? 'yes' : 'no',
    truncate(asset.prompt, 48),
  ]);
  const lines = padColumns(rows, ['ID', 'NAME', 'CATEGORY', 'UPDATED', 'ARCHIVED', 'PROMPT'], [36, 24, 16, 10, 8, 48]);
  return `${lines.join('\n')}\n`;
}

export function renderUploadTable(uploads: readonly UploadSummary[]): string {
  const rows = uploads.map((upload) => [
    upload.id,
    truncate(upload.name, 24),
    upload.mimeType,
    formatBytes(upload.sizeBytes),
    day(upload.createdAt),
    upload.archivedAt ? 'yes' : 'no',
  ]);
  const lines = padColumns(rows, ['ID', 'NAME', 'MIME', 'SIZE', 'CREATED', 'ARCHIVED'], [36, 24, 12, 10, 10, 8]);
  return `${lines.join('\n')}\n`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function field(label: string, value: string, width = 10): string {
  return `  ${`${label}:`.padEnd(width)}${value}`;
}

export function renderAsset(asset: PublicAsset): string {
  const metadata = JSON.stringify(asset.metadata);
  const lines = [
    asset.name,
    field('id', asset.id),
    field('category', asset.category ?? '-'),
    field('archived', asset.archivedAt ? `yes (${stamp(asset.archivedAt)})` : 'no'),
    field('created', stamp(asset.createdAt)),
    field('updated', stamp(asset.updatedAt)),
  ];
  if (metadata !== '{}') {
    lines.push(field('metadata', metadata));
  }
  lines.push('', 'prompt:', ...asset.prompt.split('\n').map((line) => `  ${line}`));
  return `${lines.join('\n')}\n`;
}

export function renderUpload(upload: UploadSummary, outPath?: string): string {
  const lines = [
    upload.name,
    field('id', upload.id),
    field('mimeType', upload.mimeType),
    field('size', `${formatBytes(upload.sizeBytes)} (${upload.sizeBytes} bytes)`),
    field('archived', upload.archivedAt ? `yes (${stamp(upload.archivedAt)})` : 'no'),
    field('created', stamp(upload.createdAt)),
    field('updated', stamp(upload.updatedAt)),
  ];
  if (outPath) {
    lines.push(field('saved', outPath));
  }
  return `${lines.join('\n')}\n`;
}
