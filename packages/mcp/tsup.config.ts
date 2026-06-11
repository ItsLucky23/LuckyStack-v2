import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
  target: 'node20',
  //? dist/index.js is the published `luckystack-mcp` bin AND the command Claude
  //? Code spawns from .mcp.json — it must be directly executable.
  banner: { js: '#!/usr/bin/env node' },
  //? Keep the SDK + zod external (resolved from node_modules at runtime); never
  //? inline @luckystack/* either.
  external: [/^@luckystack\//],
  skipNodeModulesBundle: true,
});
