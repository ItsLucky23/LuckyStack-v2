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
//
// Optional peer-deps of `@luckystack/*` packages are also marked external.
// Each adapter wraps these in a boot-time `createRequire.resolve` guard +
// dynamic `import()`. esbuild's bundler would otherwise try to follow the
// dynamic import and fail when the peer isn't installed in the consumer's
// project. Listing them here keeps the build green regardless of which
// adapters the consumer actually wires up.
const optionalPeerDeps = [
  // @luckystack/email
  'nodemailer',
  'resend',
  // @luckystack/error-tracking
  '@sentry/node',
  'dd-trace',
  'hot-shots',
  'posthog-node',
  // @luckystack/secret-manager (optional — dynamically imported behind a URL guard
  // in server/bootstrap/initSecrets.ts; left external so a project that doesn't use
  // it bundles + boots without the package installed).
  '@luckystack/secret-manager',
];

const externalDeps = [
  ...new Set([
    ...dependencyNames,
    ...nodeBuiltins,
    ...optionalPeerDeps,
    '@luckystack/devkit',
  ]),
];

//? Source maps are OFF by default: shipping `dist/server.js.map` beside the
//? bundle leaks the full readable server source (a source-disclosure risk if a
//? consumer ever wires real dist/-rooted static serving). Opt in for local
//? debugging with `BUNDLE_SERVER_SOURCEMAP=1`. Mirrors the consumer template
//? copy (`packages/create-luckystack-app/template/scripts/bundleServer.mjs`).
const enableSourcemap = process.env.BUNDLE_SERVER_SOURCEMAP === '1';

const run = async () => {
  await build({
    entryPoints: ['server/server.ts'],
    outfile: 'dist/server.js',
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    sourcemap: enableSourcemap,
    external: externalDeps,
    logLevel: 'info',
    alias: {
      '@luckystack/core': path.join(root, 'packages/core/src/index.ts'),
      '@luckystack/login': path.join(root, 'packages/login/src/index.ts'),
      '@luckystack/sync': path.join(root, 'packages/sync/src/index.ts'),
      '@luckystack/error-tracking': path.join(root, 'packages/error-tracking/src/index.ts'),
      '@luckystack/api': path.join(root, 'packages/api/src/index.ts'),
      '@luckystack/presence': path.join(root, 'packages/presence/src/index.ts'),
    },
  });
};

run().catch((error) => {
  console.error('Build failed:', error);
  process.exit(1);
});
