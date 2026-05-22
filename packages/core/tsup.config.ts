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
  entry: ['src/index.ts', 'src/client.ts', 'src/eslint/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  skipNodeModulesBundle: true,
  external: [/^@luckystack\//, 'eslint'],
  target: 'es2022',
});
