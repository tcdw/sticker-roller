import { basename } from 'node:path';
import type { Repositories } from './db/repositories';
import type { UploadSummary } from './db/schema';
import { InputError } from './errors';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_NAME_LENGTH = 200;

const IMAGE_SIGNATURES: Array<{ mimeType: string; test: (bytes: Uint8Array) => boolean }> = [
  {
    mimeType: 'image/png',
    test: (b) => b.length > 3 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  },
  { mimeType: 'image/jpeg', test: (b) => b.length > 2 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    mimeType: 'image/webp',
    test: (b) => b.length > 11 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
  },
];

/** Trust bytes over the client-provided content type when deciding what was uploaded. */
export function sniffImageMimeType(bytes: Uint8Array): string | null {
  return IMAGE_SIGNATURES.find((signature) => signature.test(bytes))?.mimeType ?? null;
}

/**
 * Store a local image file as a reference upload, using the same size and byte-signature
 * checks the HTTP upload route applies. Throws InputError for anything the caller can fix.
 */
export async function uploadFileFromPath(repo: Repositories, filePath: string): Promise<UploadSummary> {
  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    throw new InputError(`image file not found: ${filePath}`);
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new InputError(`image must be at most ${MAX_UPLOAD_BYTES} bytes: ${filePath}`);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mimeType = sniffImageMimeType(bytes);
  if (!mimeType) {
    throw new InputError(`only PNG, JPEG, or WebP images are supported: ${filePath}`);
  }
  return repo.createUpload({
    name: basename(filePath).slice(0, MAX_NAME_LENGTH) || 'image',
    mimeType,
    sizeBytes: bytes.byteLength,
    data: Buffer.from(bytes).toString('base64'),
  });
}
