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
  splitting: false,
  skipNodeModulesBundle: true,
  external: [/^@luckystack\//],
  target: 'es2022',
  banner: ({ format: _format }) => ({ js: '' }),
});
