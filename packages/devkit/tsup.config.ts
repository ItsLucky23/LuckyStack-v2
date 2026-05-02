import { defineConfig } from 'tsup';

//? devkit is tier-B (project-glue) but emits dts so consumers (project
//? scripts, future plugins) get types. The package's tsconfig omits
//? `rootDir` so tsc accepts cross-`src` imports from project files
//? (e.g. server/utils/responseNormalizer for hot-reload). Output layout
//? is unaffected — rollup-plugin-dts bundles into dist/index.d.ts
//? regardless of where intermediate files came from.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  skipNodeModulesBundle: true,
  external: [/^@luckystack\//],
  target: 'es2022',
});
