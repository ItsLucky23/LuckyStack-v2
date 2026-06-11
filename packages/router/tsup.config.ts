import { defineConfig } from 'tsup';

//? Router publishes both the runtime API (`./index.ts`) and a CLI entry
//? (`./cli.ts`). The CLI is wired via `bin` in package.json so consumers
//? can `npx luckystack-router --config ./dist/deploy.config.js ...` without
//? writing a project-side entry script.
export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['esm'],
  dts: { entry: 'src/index.ts' },
  sourcemap: true,
  clean: true,
  //? splitting MUST stay on for multi-entry packages: with it off, tsup inlines
  //? a private COPY of every shared module into each entry, so registry state
  //? written via one entry (e.g. ./register) is invisible through the other.
  splitting: true,
  skipNodeModulesBundle: true,
  external: [/^@luckystack\//],
  target: 'es2022',
  banner: ({ format: _format }) => ({ js: '' }),
});
