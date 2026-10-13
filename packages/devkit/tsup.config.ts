import { cp } from 'node:fs/promises';

import { defineConfig } from 'tsup';

//? devkit is tier-B (project-glue) but ships declarations so consumers
//? (project scripts, future plugins) get types. They come from
//? `tsc -b tsconfig.packages.json`; clean keeps them.
export default defineConfig({
  entry: ['src/index.ts', 'src/cli/validateDeploy.ts', 'src/supervisor.ts'],
  format: ['esm'],
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
  //? `templateInjector.ts` reads `dist/templates/*.template.ts(x)` at runtime
  //? via fs.readFileSync. tsup bundles from entry imports only, so the raw
  //? template files are NOT emitted by the build — copy them into dist so the
  //? PUBLISHED package can find them (otherwise template injection ENOENTs in a
  //? consumer install). `files: ["dist", ...]` then ships them in the tarball.
  onSuccess: async () => {
    await cp('src/templates', 'dist/templates', { recursive: true });
  },
});
