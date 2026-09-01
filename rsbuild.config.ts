import { defineConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";

export default defineConfig({
  plugins: [pluginReact()],
  source: { entry: { index: "./web/src/main.tsx" } },
  html: { template: "./web/index.html" },
  output: { distPath: { root: "dist" } },
});
