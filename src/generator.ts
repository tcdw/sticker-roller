import { GoogleGenAI } from "@google/genai";
import { generateText, createGateway } from "ai";
import { join } from "node:path";
import {
  type StickerConfig,
  DEFAULT_ASPECT_RATIO,
  DEFAULT_IMAGE_SIZE,
} from "./config";

const OUTPUT_DIR = join(import.meta.dir, "..", "output");

export interface GenerateOptions {
  sticker: StickerConfig;
  count: number;
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
 * Generate images using Vercel AI SDK via ai-gateway
 */
async function generateWithGateway(
  options: GenerateOptions,
  aspectRatio: string,
  imageSize: string
): Promise<GenerateResult[]> {
  const gateway = createGateway({
    baseURL: process.env.AI_GATEWAY_URL,
    apiKey: process.env.AI_GATEWAY_TOKEN,
  });

  const results: GenerateResult[] = [];
  const timestamp = Date.now();

  for (let i = 0; i < options.count; i++) {
    options.onProgress?.(i + 1, options.count);

    try {
      // Build message content with reference images
      const content: Array<
        { type: "text"; text: string } | { type: "image"; image: string; mimeType: string }
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
        model: gateway("google/gemini-3-pro-image"),
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
 * Generate images using Google GenAI SDK directly
 */
async function generateWithDirectAPI(
  options: GenerateOptions,
  aspectRatio: string,
  imageSize: string
): Promise<GenerateResult[]> {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY environment variable is not set. Please set it in your .env file."
    );
  }

  const userAgent = process.env.GEMINI_USER_AGENT;
  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      // Explicitly set baseUrl to avoid GOOGLE_GEMINI_BASE_URL env var override
      baseUrl: "https://generativelanguage.googleapis.com",
      headers: userAgent ? { "User-Agent": userAgent } : undefined,
    },
  });

  const config = {
    responseModalities: ["IMAGE", "TEXT"],
    imageConfig: {
      aspectRatio,
      imageSize,
    },
  };

  const model = "gemini-3-pro-image-preview";
  const results: GenerateResult[] = [];
  const timestamp = Date.now();

  for (let i = 0; i < options.count; i++) {
    options.onProgress?.(i + 1, options.count);

    try {
      // Build content parts
      const parts: Array<
        { text: string } | { inlineData: { data: string; mimeType: string } }
      > = [];

      // Add reference images (sorted by filename, e.g., 1_myself.png, 2_them.png)
      for (const refImage of options.sticker.referenceImages) {
        parts.push({
          inlineData: {
            data: refImage.data,
            mimeType: refImage.mimeType,
          },
        });
      }

      // Add prompt
      parts.push({ text: options.sticker.prompt });

      const contents = [
        {
          role: "user" as const,
          parts,
        },
      ];

      const response = await ai.models.generateContent({
        model,
        config,
        contents,
      });

      // Find image in response
      let savedFile = false;

      if (response.candidates && response.candidates.length > 0) {
        const candidate = response.candidates[0];
        if (candidate?.content?.parts) {
          for (const part of candidate.content.parts) {
            if ("inlineData" in part && part.inlineData) {
              const imageData = part.inlineData.data;
              const mimeType = part.inlineData.mimeType || "image/png";

              // Determine file extension
              let ext = ".png";
              if (mimeType === "image/jpeg") ext = ".jpg";
              else if (mimeType === "image/webp") ext = ".webp";

              const fileName = `${options.sticker.name}-${timestamp}-${i + 1}${ext}`;
              const filePath = join(OUTPUT_DIR, fileName);

              // Save the image
              const buffer = Buffer.from(imageData as string, "base64");
              await Bun.write(filePath, buffer);

              results.push({
                success: true,
                filePath,
              });
              savedFile = true;
              break;
            }
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

export async function generateImages(
  options: GenerateOptions
): Promise<GenerateResult[]> {
  const aspectRatio =
    options.aspectRatio ||
    options.sticker.aspectRatio ||
    DEFAULT_ASPECT_RATIO;
  const imageSize =
    options.imageSize || options.sticker.imageSize || DEFAULT_IMAGE_SIZE;

  if (isGatewayMode()) {
    return generateWithGateway(options, aspectRatio, imageSize);
  } else {
    return generateWithDirectAPI(options, aspectRatio, imageSize);
  }
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
