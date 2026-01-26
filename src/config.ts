import { readdir } from "node:fs/promises";
import { join } from "node:path";

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
}

export interface StickerOverrideConfig {
  aspectRatio?: string;
  imageSize?: string;
}

const STICKERS_DIR = join(import.meta.dir, "..", "stickers");
const SUPPORTED_IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp"];

function getMimeType(ext: string): string {
  const mimeTypes: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
  };
  return mimeTypes[ext] || "application/octet-stream";
}

function getExtension(fileName: string): string {
  const lastDot = fileName.lastIndexOf(".");
  if (lastDot === -1) return "";
  return fileName.slice(lastDot).toLowerCase();
}

export async function listStickers(): Promise<string[]> {
  try {
    const entries = await readdir(STICKERS_DIR, { withFileTypes: true });
    const stickers: string[] = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const promptPath = join(STICKERS_DIR, entry.name, "prompt.txt");
        const promptFile = Bun.file(promptPath);
        if (await promptFile.exists()) {
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

  // Load prompt
  const promptPath = join(stickerDir, "prompt.txt");
  const promptFile = Bun.file(promptPath);

  if (!(await promptFile.exists())) {
    throw new Error(`Sticker "${name}" not found or missing prompt.txt`);
  }

  const prompt = (await promptFile.text()).trim();

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
      data: Buffer.from(buffer).toString("base64"),
      mimeType: getMimeType(ext),
      fileName,
    });
  }

  // Load optional config override
  let overrideConfig: StickerOverrideConfig = {};
  const configPath = join(stickerDir, "config.json");
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

export const SUPPORTED_ASPECT_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4"];
export const SUPPORTED_IMAGE_SIZES = ["1K", "2K", "4K"];
export const DEFAULT_ASPECT_RATIO = "1:1";
export const DEFAULT_IMAGE_SIZE = "1K";
