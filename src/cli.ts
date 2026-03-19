import { parseArgs } from "node:util";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { select, input, confirm } from "@inquirer/prompts";
import {
  listStickers,
  listIncludes,
  loadSticker,
  STICKERS_DIR,
  SUPPORTED_ASPECT_RATIOS,
  SUPPORTED_IMAGE_SIZES,
  DEFAULT_ASPECT_RATIO,
  DEFAULT_IMAGE_SIZE,
} from "./config";
import { generateImages, getGeneratorMode } from "./generator";
import { $ } from "bun";

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
        `Error: ratio must be one of: ${SUPPORTED_ASPECT_RATIOS.join(", ")}`,
      );
      process.exit(1);
    }

    const size = values.size || DEFAULT_IMAGE_SIZE;
    if (!SUPPORTED_IMAGE_SIZES.includes(size)) {
      console.error(
        `Error: size must be one of: ${SUPPORTED_IMAGE_SIZES.join(", ")}`,
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

async function generateStickerInteractive(): Promise<CLIOptions> {
  const stickers = await listStickers();

  if (stickers.length === 0) {
    console.error(
      "No stickers found. Create a sticker folder in stickers/ with a prompt.txt file.",
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
    const fileNames = stickerConfig.referenceImages
      .map((r) => r.fileName)
      .join(", ");
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

  if (process.platform === "darwin") {
    try {
      await $`which terminal-notifier`.quiet();
      await $`terminal-notifier -title "贴纸生成任务完成" -message "生成了 ${successCount}/${results.length} 张图片" -sound Glass`;
    } catch {
      // Ignore if terminal-notifier is not installed
    }
  }
}

async function createStickerInteractive(): Promise<void> {
  const currentDate = new Date().toISOString().slice(0, 10).replace(/-/g, ""); // Returns YYYYMMDD
  const name = await input({
    message: "Sticker name:",
    default: `${currentDate}_sticker_name`,
    validate: (value) => {
      if (!value.match(/^[a-zA-Z0-9_-]+$/)) {
        return "Name must contain only letters, numbers, underscores, and dashes";
      }
      return true;
    },
  });

  const bases = await listIncludes();
  let baseTemplate = "";

  if (bases.length > 0) {
    baseTemplate = await select({
      message: "Select a base template (optional):",
      choices: [
        { name: "None", value: "" },
        ...bases.map((b) => ({ name: b, value: b })),
      ],
    });
  }

  const stickerDir = join(STICKERS_DIR, name);
  const promptPath = join(stickerDir, "prompt.md");

  // Check if directory exists (simple check via prompt file)
  if (await Bun.file(promptPath).exists()) {
    console.error(`Error: Sticker "${name}" already exists.`);
    process.exit(1);
  }

  await mkdir(stickerDir, { recursive: true });

  const content = baseTemplate ? `{{include: ${baseTemplate}}}\n\n` : "";

  await Bun.write(promptPath, content);

  console.log(`\n✓ Created sticker: ${name}`);
  console.log(`  Path: ${promptPath}`);
  console.log(
    `  You can now edit prompt.md and add reference images to the folder.`,
  );
}

export async function main(): Promise<void> {
  const args = parseArguments();

  if (args) {
    try {
      await run(args);
    } catch (error) {
      console.error(
        "Error:",
        error instanceof Error ? error.message : String(error),
      );
      process.exit(1);
    }
    return;
  }

  // Interactive menu
  const action = await select({
    message: "What do you want to do?",
    choices: [
      { name: "Generate Sticker Images", value: "generate" },
      { name: "Create New Sticker", value: "create" },
      { name: "Exit", value: "exit" },
    ],
  });

  try {
    if (action === "generate") {
      const options = await generateStickerInteractive();
      await run(options);
    } else if (action === "create") {
      await createStickerInteractive();
    }
  } catch (error) {
    console.error(
      "Error:",
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  }
}
