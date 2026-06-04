import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
  target: 'node20',
  //? Match every sibling package: never inline @luckystack/* or node_modules
  //? into the bundle (keeps deps external + the entry thin). Harmless today
  //? (zero deps) but prevents a future runtime dep being silently inlined.
  external: [/^@luckystack\//],
  skipNodeModulesBundle: true,
});
