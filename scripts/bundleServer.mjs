import { build } from 'esbuild';
import { builtinModules } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const packageJsonRaw = fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8');
const packageJson = JSON.parse(packageJsonRaw);

const dependencyNames = Object.keys(packageJson.dependencies || {});
const nodeBuiltins = builtinModules.flatMap((moduleName) => {
  const normalized = moduleName.replace(/^node:/, '');
  return [normalized, `node:${normalized}`];
});

// Devkit is a dev-time-only package; mark it external so esbuild does not
// bundle `server/dev/**` or the TypeScript compiler into the production
// server. Runtime consumers (`server/server.ts`, `server/prod/runtimeMaps.ts`)
// only reach devkit behind an `env.NODE_ENV !== 'production'` guard, so
// leaving the import unresolved in prod is safe — the branch never executes.
const externalDeps = [
  ...new Set([
    ...dependencyNames,
    ...nodeBuiltins,
    '@luckystack/devkit',
  ]),
];

const run = async () => {
  await build({
    entryPoints: ['server/server.ts'],
    outfile: 'dist/server.js',
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    sourcemap: true,
    external: externalDeps,
    logLevel: 'info',
    alias: {
      '@luckystack/core': path.join(root, 'packages/core/src/index.ts'),
      '@luckystack/login': path.join(root, 'packages/login/src/index.ts'),
      '@luckystack/sync': path.join(root, 'packages/sync/src/index.ts'),
      '@luckystack/sentry': path.join(root, 'packages/sentry/src/index.ts'),
      '@luckystack/api': path.join(root, 'packages/api/src/index.ts'),
    },
  });
};

run().catch((error) => {
  console.error('Build failed:', error);
  process.exit(1);
});
