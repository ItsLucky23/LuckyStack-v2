import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/register.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  //? MUST stay on for multi-entry: `./register` shares the scheduler/registry
  //? singletons with the main entry — `splitting: false` would inline a private
  //? copy per entry and state written via `./register` would be invisible
  //? through `.`.
  splitting: true,
  skipNodeModulesBundle: true,
  external: [/^@luckystack\//],
  target: 'es2022',
});
