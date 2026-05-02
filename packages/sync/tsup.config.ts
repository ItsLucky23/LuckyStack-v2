import { defineConfig } from 'tsup';

//? Two entries: `./` (server-safe handlers) and `./client` (browser
//? transport). Same reason as @luckystack/core — React-coupled code is
//? quarantined to the client subpath so server consumers don't pull JSX
//? compilation into their build.
export default defineConfig({
  entry: ['src/index.ts', 'src/client.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  skipNodeModulesBundle: true,
  external: [/^@luckystack\//],
  target: 'es2022',
});
