import { readdir } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, resolve } from 'node:path';

export interface ReferenceImage {
  data: string; // base64
  mimeType: string;
  fileName: string;
}

export interface StickerConfig {
  name: string;
  prompt: string;
  referenceImages: ReferenceImage[]; // 支持多张参考图，按文件名排序
  aspectRatio?: string;
  imageSize?: string;
  removeBackground?: boolean;
}

export interface StickerOverrideConfig {
  aspectRatio?: string;
  imageSize?: string;
  removeBackground?: boolean;
}

export const STICKERS_DIR = join(import.meta.dir, '..', 'stickers');
const SUPPORTED_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];
const INCLUDE_PATTERN = /\{\{\s*include\s*:\s*([^}]+?)\s*\}\}/g;
const INCLUDE_DIRS = [join(STICKERS_DIR, '_includes')];
const MAX_INCLUDE_DEPTH = 20;

function normalizeIncludePath(rawPath: string): string {
  const trimmed = rawPath.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function getIncludeCandidates(rawPath: string, currentDir: string): string[] {
  const normalized = normalizeIncludePath(rawPath);
  if (!normalized) {
    return [];
  }

  const hasExtension = extname(normalized) !== '';
  const suffixes = hasExtension ? [''] : ['.md', '.txt', ''];
  const candidates: string[] = [];

  if (isAbsolute(normalized)) {
    for (const suffix of suffixes) {
      candidates.push(normalized + suffix);
    }
  } else {
    const bases = [currentDir, ...INCLUDE_DIRS];
    for (const base of bases) {
      for (const suffix of suffixes) {
        candidates.push(join(base, normalized + suffix));
      }
    }
  }

  return candidates;
}

async function resolveIncludePath(rawPath: string, currentDir: string): Promise<string | null> {
  const candidates = getIncludeCandidates(rawPath, currentDir);

  for (const candidate of candidates) {
    const absolutePath = resolve(candidate);
    const file = Bun.file(absolutePath);
    if (await file.exists()) {
      return absolutePath;
    }
  }

  return null;
}

async function readPromptFile(filePath: string, stack: string[]): Promise<string> {
  const absolutePath = resolve(filePath);

  if (stack.includes(absolutePath)) {
    throw new Error(`Circular include detected: ${[...stack, absolutePath].join(' -> ')}`);
  }

  if (stack.length >= MAX_INCLUDE_DEPTH) {
    throw new Error(`Include depth exceeded ${MAX_INCLUDE_DEPTH}. Check for nested includes.`);
  }

  stack.push(absolutePath);

  try {
    const fileText = await Bun.file(absolutePath).text();

    if (!absolutePath.endsWith('.md')) {
      return fileText;
    }

    const parts: string[] = [];
    let lastIndex = 0;

    for (const match of fileText.matchAll(INCLUDE_PATTERN)) {
      if (match.index === undefined) {
        continue;
      }

      parts.push(fileText.slice(lastIndex, match.index));

      const rawIncludePath = match[1];
      if (rawIncludePath === undefined) {
        continue;
      }

      const includePath = await resolveIncludePath(rawIncludePath, dirname(absolutePath));

      if (!includePath) {
        throw new Error(`Include file not found: "${rawIncludePath.trim()}" (from ${absolutePath})`);
      }

      const includedText = await readPromptFile(includePath, stack);
      parts.push(includedText);

      lastIndex = match.index + match[0].length;
    }

    parts.push(fileText.slice(lastIndex));
    return parts.join('');
  } finally {
    stack.pop();
  }
}

async function loadPromptWithIncludes(promptPath: string): Promise<string> {
  const combined = await readPromptFile(promptPath, []);
  return combined.trim();
}

function getMimeType(ext: string): string {
  const mimeTypes: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

function getExtension(fileName: string): string {
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot === -1) {
    return '';
  }
  return fileName.slice(lastDot).toLowerCase();
}

async function findPromptFile(stickerDir: string): Promise<string | null> {
  // Try prompt.md first, then prompt.txt
  for (const fileName of ['prompt.md', 'prompt.txt']) {
    const filePath = join(stickerDir, fileName);
    const file = Bun.file(filePath);
    if (await file.exists()) {
      return filePath;
    }
  }
  return null;
}

export async function listStickers(): Promise<string[]> {
  try {
    const entries = await readdir(STICKERS_DIR, { withFileTypes: true });
    const stickers: string[] = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const promptPath = await findPromptFile(join(STICKERS_DIR, entry.name));
        if (promptPath) {
          stickers.push(entry.name);
        }
      }
    }

    return stickers.sort();
  } catch {
    return [];
  }
}

export async function loadSticker(name: string): Promise<StickerConfig> {
  const stickerDir = join(STICKERS_DIR, name);

  // Load prompt (prefer .md over .txt)
  const promptPath = await findPromptFile(stickerDir);

  if (!promptPath) {
    throw new Error(`Sticker "${name}" not found or missing prompt.md/prompt.txt`);
  }

  const prompt = await loadPromptWithIncludes(promptPath);

  // Load reference images (sorted by filename)
  const referenceImages: ReferenceImage[] = [];
  const entries = await readdir(stickerDir, { withFileTypes: true });

  // Find all image files
  const imageFiles: string[] = [];
  for (const entry of entries) {
    if (entry.isFile()) {
      const ext = getExtension(entry.name);
      if (SUPPORTED_IMAGE_EXTENSIONS.includes(ext)) {
        imageFiles.push(entry.name);
      }
    }
  }

  // Sort by filename (e.g., 1_myself.png, 2_them.png)
  imageFiles.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  // Load each image
  for (const fileName of imageFiles) {
    const imagePath = join(stickerDir, fileName);
    const imageFile = Bun.file(imagePath);
    const buffer = await imageFile.arrayBuffer();
    const ext = getExtension(fileName);

    referenceImages.push({
      data: Buffer.from(buffer).toString('base64'),
      mimeType: getMimeType(ext),
      fileName,
    });
  }

  // Load optional config override
  let overrideConfig: StickerOverrideConfig = {};
  const configPath = join(stickerDir, 'config.json');
  const configFile = Bun.file(configPath);

  if (await configFile.exists()) {
    try {
      overrideConfig = await configFile.json();
    } catch {
      // Ignore invalid config
    }
  }

  return {
    name,
    prompt,
    referenceImages,
    ...overrideConfig,
  };
}

export async function listIncludes(): Promise<string[]> {
  try {
    const includesDir = INCLUDE_DIRS[0];
    if (includesDir === undefined) {
      return [];
    }

    const entries = await readdir(includesDir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && !e.name.startsWith('.'))
      .map((e) => e.name.replace(/\.[^/.]+$/, '')) // Remove extension
      .sort();
  } catch {
    return [];
  }
}

export { DEFAULT_MODEL, SUPPORTED_ASPECT_RATIOS, SUPPORTED_IMAGE_SIZES, SUPPORTED_MODELS } from './image-options';
export const DEFAULT_ASPECT_RATIO = '1:1';
export const DEFAULT_IMAGE_SIZE = '1K';
export const DEFAULT_REMOVE_BACKGROUND = true;

export const BACKGROUND_KEY_COLOR = '#FF00FF';
