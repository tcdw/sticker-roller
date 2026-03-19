import { generateText, createGateway } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { join } from "node:path";
import {
  type StickerConfig,
  DEFAULT_ASPECT_RATIO,
  DEFAULT_IMAGE_SIZE,
  DEFAULT_MODEL,
} from "./config";

const OUTPUT_DIR = join(import.meta.dir, "..", "output");

export interface GenerateOptions {
  sticker: StickerConfig;
  count: number;
  model?: string;
  aspectRatio?: string;
  imageSize?: string;
  onProgress?: (current: number, total: number) => void;
}

export interface GenerateResult {
  success: boolean;
  filePath?: string;
  error?: string;
}

type ImageConfigAspectRatio =
  | "1:1"
  | "2:3"
  | "3:2"
  | "3:4"
  | "4:3"
  | "4:5"
  | "5:4"
  | "9:16"
  | "16:9"
  | "21:9";

type ImageConfigSize = "1K" | "2K" | "4K";

/**
 * Check if AI Gateway mode is enabled
 */
function isGatewayMode(): boolean {
  return !!(process.env.AI_GATEWAY_URL && process.env.AI_GATEWAY_TOKEN);
}

/**
 * Create the appropriate provider based on mode
 */
function createProvider() {
  if (isGatewayMode()) {
    return createGateway({
      baseURL: process.env.AI_GATEWAY_URL,
      apiKey: process.env.AI_GATEWAY_TOKEN,
    });
  } else {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "GEMINI_API_KEY environment variable is not set. Please set it in your .env file.",
      );
    }

    const userAgent = process.env.GEMINI_USER_AGENT;
    return createGoogleGenerativeAI({
      apiKey,
      headers: userAgent ? { "User-Agent": userAgent } : undefined,
    });
  }
}

/**
 * Get the model ID based on mode and configuration
 */
function getModelId(modelName: string = DEFAULT_MODEL): string {
  if (isGatewayMode()) {
    // Gateway uses the mapped model name
    // For gemini-3-pro-image, it maps to google/gemini-3-pro-image
    // For gemini-3.1-flash-image-preview, assume it maps similarly
    if (modelName === "gemini-3-pro-image") {
      return "google/gemini-3-pro-image";
    }
    return `google/${modelName}`;
  } else {
    // Direct API uses the actual model name
    if (modelName === "gemini-3-pro-image") {
      return "gemini-3-pro-image-preview";
    }
    return modelName;
  }
}

export async function generateImages(
  options: GenerateOptions,
): Promise<GenerateResult[]> {
  const aspectRatio =
    options.aspectRatio || options.sticker.aspectRatio || DEFAULT_ASPECT_RATIO;
  const imageSize =
    options.imageSize || options.sticker.imageSize || DEFAULT_IMAGE_SIZE;

  const provider = createProvider();
  const modelId = getModelId(options.model);
  const results: GenerateResult[] = [];
  const timestamp = Date.now();

  for (let i = 0; i < options.count; i++) {
    options.onProgress?.(i + 1, options.count);

    try {
      // Build message content with reference images
      const content: Array<
        | { type: "text"; text: string }
        | { type: "image"; image: string; mimeType: string }
      > = [];

      // Add reference images
      for (const refImage of options.sticker.referenceImages) {
        content.push({
          type: "image",
          image: refImage.data,
          mimeType: refImage.mimeType,
        });
      }

      // Add prompt
      content.push({ type: "text", text: options.sticker.prompt });

      const result = await generateText({
        model: provider(modelId),
        messages: [{ role: "user", content }],
        providerOptions: {
          google: {
            imageConfig: {
              aspectRatio: aspectRatio as ImageConfigAspectRatio,
              imageSize: imageSize as ImageConfigSize,
            },
          },
        },
      });

      // Find image in response files
      let savedFile = false;

      if (result.files && result.files.length > 0) {
        for (const file of result.files) {
          if (file.mediaType?.startsWith("image/")) {
            const mimeType = file.mediaType;

            // Determine file extension
            let ext = ".png";
            if (mimeType === "image/jpeg") ext = ".jpg";
            else if (mimeType === "image/webp") ext = ".webp";

            const fileName = `${options.sticker.name}-${timestamp}-${i + 1}${ext}`;
            const filePath = join(OUTPUT_DIR, fileName);

            // Save the image
            const imageData = Buffer.from(file.base64, "base64");
            await Bun.write(filePath, imageData);

            results.push({
              success: true,
              filePath,
            });
            savedFile = true;
            break;
          }
        }
      }

      if (!savedFile) {
        results.push({
          success: false,
          error: "No image in response",
        });
      }
    } catch (error) {
      results.push({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}

/**
 * Get the current mode description
 */
export function getGeneratorMode(): string {
  if (isGatewayMode()) {
    return `AI Gateway (${process.env.AI_GATEWAY_URL})`;
  } else {
    return "Direct Google API";
  }
}
