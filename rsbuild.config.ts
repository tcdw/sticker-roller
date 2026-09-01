import { resolve } from 'node:path';
import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';

export default defineConfig({
  plugins: [pluginReact()],
  source: { entry: { index: './web/src/main.tsx' } },
  resolve: { alias: { '@': resolve(import.meta.dirname, 'web/src') } },
  html: { template: './web/index.html' },
  output: { distPath: { root: 'dist' } },
});
