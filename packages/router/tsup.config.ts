import { defineConfig } from 'tsup';

//? Router is tier-B (project-glue) — it imports `deploy.config` and
//? `services.config` from the project root by design (router topology is
//? project-specific). The package's tsconfig omits `rootDir` so tsc
//? accepts those project imports for dts generation. Output layout is
//? unaffected — rollup-plugin-dts bundles into dist/index.d.ts.
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
