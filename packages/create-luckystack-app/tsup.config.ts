import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: false, // CLI bin entry — no type declarations needed
  sourcemap: false,
  clean: true,
  splitting: false,
  skipNodeModulesBundle: true,
  banner: { js: '#!/usr/bin/env node' },
  target: 'es2022',
});
