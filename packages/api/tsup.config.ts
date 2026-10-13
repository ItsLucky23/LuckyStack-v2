import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  //? Declarations come from `tsc -b tsconfig.packages.json`; clean keeps them.
  dts: false,
  sourcemap: true,
  clean: ['!**/*.d.ts', '!**/*.d.ts.map'],
  splitting: false,
  skipNodeModulesBundle: true,
  external: [/^@luckystack\//],
  target: 'es2022',
});
