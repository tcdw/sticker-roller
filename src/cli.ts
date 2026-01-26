import { parseArgs } from "node:util";
import { select, input, confirm } from "@inquirer/prompts";
import {
  listStickers,
  loadSticker,
  SUPPORTED_ASPECT_RATIOS,
  SUPPORTED_IMAGE_SIZES,
  DEFAULT_ASPECT_RATIO,
  DEFAULT_IMAGE_SIZE,
} from "./config";
import { generateImages, getGeneratorMode } from "./generator";

interface CLIOptions {
  sticker: string;
  count: number;
  ratio: string;
  size: string;
}

function parseArguments(): CLIOptions | null {
  try {
    const { values } = parseArgs({
      options: {
        sticker: { type: "string", short: "s" },
        count: { type: "string", short: "c" },
        ratio: { type: "string", short: "r" },
        size: { type: "string", short: "z" },
        help: { type: "boolean", short: "h" },
      },
      allowPositionals: false,
    });

    if (values.help) {
      printHelp();
      process.exit(0);
    }

    // If no sticker specified, return null to trigger interactive mode
    if (!values.sticker) {
      return null;
    }

    const count = values.count ? parseInt(values.count, 10) : 1;
    if (isNaN(count) || count < 1) {
      console.error("Error: count must be a positive integer");
      process.exit(1);
    }

    const ratio = values.ratio || DEFAULT_ASPECT_RATIO;
    if (!SUPPORTED_ASPECT_RATIOS.includes(ratio)) {
      console.error(
        `Error: ratio must be one of: ${SUPPORTED_ASPECT_RATIOS.join(", ")}`
      );
      process.exit(1);
    }

    const size = values.size || DEFAULT_IMAGE_SIZE;
    if (!SUPPORTED_IMAGE_SIZES.includes(size)) {
      console.error(
        `Error: size must be one of: ${SUPPORTED_IMAGE_SIZES.join(", ")}`
      );
      process.exit(1);
    }

    return {
      sticker: values.sticker,
      count,
      ratio,
      size,
    };
  } catch {
    return null;
  }
}

function printHelp(): void {
  console.log(`
Sticker Roller - Generate sticker images with Gemini AI

Usage:
  bun run index.ts [options]

Options:
  -s, --sticker <name>  Sticker name (folder name in stickers/)
  -c, --count <n>       Number of images to generate (default: 1)
  -r, --ratio <ratio>   Aspect ratio: ${SUPPORTED_ASPECT_RATIOS.join(", ")} (default: ${DEFAULT_ASPECT_RATIO})
  -z, --size <size>     Image size: ${SUPPORTED_IMAGE_SIZES.join(", ")} (default: ${DEFAULT_IMAGE_SIZE})
  -h, --help            Show this help message

Interactive Mode:
  Run without arguments to use the interactive menu.

Environment Variables:
  GEMINI_API_KEY        Your Google AI API key (required for direct mode)
  GEMINI_USER_AGENT     Custom User-Agent header (optional, direct mode only)
  AI_GATEWAY_URL        AI Gateway URL (enables gateway mode)
  AI_GATEWAY_TOKEN      AI Gateway token (required for gateway mode)

Examples:
  bun run index.ts -s example -c 5
  bun run index.ts --sticker cute-cat --count 10 --ratio 16:9 --size 2K
`);
}

async function interactiveMode(): Promise<CLIOptions> {
  const stickers = await listStickers();

  if (stickers.length === 0) {
    console.error(
      "No stickers found. Create a sticker folder in stickers/ with a prompt.txt file."
    );
    process.exit(1);
  }

  const sticker = await select({
    message: "Select a sticker:",
    choices: stickers.map((s) => ({ name: s, value: s })),
  });

  const countStr = await input({
    message: "How many images to generate?",
    default: "1",
    validate: (value) => {
      const num = parseInt(value, 10);
      if (isNaN(num) || num < 1) {
        return "Please enter a positive integer";
      }
      return true;
    },
  });
  const count = parseInt(countStr, 10);

  const ratio = await select({
    message: "Select aspect ratio:",
    choices: SUPPORTED_ASPECT_RATIOS.map((r) => ({
      name: r + (r === DEFAULT_ASPECT_RATIO ? " (default)" : ""),
      value: r,
    })),
    default: DEFAULT_ASPECT_RATIO,
  });

  const size = await select({
    message: "Select image size:",
    choices: SUPPORTED_IMAGE_SIZES.map((s) => ({
      name: s + (s === DEFAULT_IMAGE_SIZE ? " (default)" : ""),
      value: s,
    })),
    default: DEFAULT_IMAGE_SIZE,
  });

  const confirmed = await confirm({
    message: `Generate ${count} image(s) for "${sticker}" with ${ratio} ratio at ${size} resolution?`,
    default: true,
  });

  if (!confirmed) {
    console.log("Cancelled.");
    process.exit(0);
  }

  return { sticker, count, ratio, size };
}

async function run(options: CLIOptions): Promise<void> {
  console.log(`\nMode: ${getGeneratorMode()}`);
  console.log(`Loading sticker "${options.sticker}"...`);

  const stickerConfig = await loadSticker(options.sticker);

  console.log(`Prompt: ${stickerConfig.prompt.substring(0, 100)}...`);
  const refCount = stickerConfig.referenceImages.length;
  if (refCount > 0) {
    const fileNames = stickerConfig.referenceImages.map((r) => r.fileName).join(", ");
    console.log(`Reference images (${refCount}): ${fileNames}`);
  } else {
    console.log("Reference images: None");
  }
  console.log(`Generating ${options.count} image(s)...\n`);

  const results = await generateImages({
    sticker: stickerConfig,
    count: options.count,
    aspectRatio: options.ratio,
    imageSize: options.size,
    onProgress: (current, total) => {
      console.log(`Generating image ${current}/${total}...`);
    },
  });

  console.log("\n--- Results ---");
  let successCount = 0;
  for (const result of results) {
    if (result.success) {
      successCount++;
      console.log(`✓ Saved: ${result.filePath}`);
    } else {
      console.log(`✗ Failed: ${result.error}`);
    }
  }

  console.log(`\nCompleted: ${successCount}/${results.length} successful`);
}

export async function main(): Promise<void> {
  let options = parseArguments();

  if (!options) {
    // Interactive mode
    options = await interactiveMode();
  }

  try {
    await run(options);
  } catch (error) {
    console.error(
      "Error:",
      error instanceof Error ? error.message : String(error)
    );
    process.exit(1);
  }
}
