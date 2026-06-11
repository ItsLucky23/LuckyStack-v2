import { defineConfig } from 'tsup';

//? CLI bin entry — esbuild bundles src into a single ESM file with a node
//? shebang. No type declarations (nothing imports this package's types).
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: false,
  sourcemap: false,
  clean: true,
  splitting: false,
  skipNodeModulesBundle: true,
  banner: { js: '#!/usr/bin/env node' },
  target: 'es2022',
});
