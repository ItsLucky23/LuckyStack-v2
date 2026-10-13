import { defineConfig } from 'tsup';

//? Two entries: `./` (server-safe handlers) and `./client` (browser
//? transport). Same reason as @luckystack/core — React-coupled code is
//? quarantined to the client subpath so server consumers don't pull JSX
//? compilation into their build.
export default defineConfig({
  entry: ['src/index.ts', 'src/client.ts'],
  format: ['esm'],
  //? Declarations come from `tsc -b tsconfig.packages.json`; clean keeps them.
  dts: false,
  sourcemap: true,
  clean: ['!**/*.d.ts', '!**/*.d.ts.map'],
  //? splitting MUST stay on for multi-entry packages: with it off, tsup inlines
  //? a private COPY of every shared module into each entry, so registry state
  //? written via one entry (e.g. ./register) is invisible through the other.
  splitting: true,
  skipNodeModulesBundle: true,
  external: [/^@luckystack\//],
  target: 'es2022',
});
