import { defineConfig } from 'tsup';

//? @luckystack/core ships two entries:
//?   - `./` (index.ts): server-safe surface (Redis, sockets, registries).
//?   - `./client` (client.ts): browser-safe transport (apiRequest).
//? They're split because apiRequest pulls React-coupled project code.
//?
//? Sister @luckystack/* imports stay external — consumers install them
//? alongside this package. Third-party deps come from node_modules at
//? consume time (skipNodeModulesBundle).
export default defineConfig({
  entry: ['src/index.ts', 'src/client.ts', 'src/config.ts', 'src/eslint/index.ts', 'src/apiTypeStubs.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  //? splitting MUST stay on for multi-entry packages: with it off, tsup inlines
  //? a private COPY of every shared module into each entry, so registry state
  //? written via one entry (e.g. ./register) is invisible through the other.
  splitting: true,
  skipNodeModulesBundle: true,
  external: [/^@luckystack\//, 'eslint'],
  target: 'es2022',
});
