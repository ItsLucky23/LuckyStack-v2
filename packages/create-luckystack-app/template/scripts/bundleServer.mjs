//? Production server bundle. Compiles `server/server.ts` (TypeScript ESM) down
//? to `dist/server.js`, which `npm run prod` runs. Unlike the framework repo's
//? own bundler, a SCAFFOLDED project resolves every `@luckystack/*` package (and
//? all other runtime deps) from `node_modules` at runtime — so we mark them all
//? `external` and let Node resolve them, instead of aliasing into monorepo
//? sources. esbuild only inlines the project's OWN `server/`, `shared/`,
//? `config.ts`, and `luckystack/` overlay code.
import { build } from 'esbuild';
import { builtinModules } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

//? Everything declared as a (dev)dependency resolves from node_modules in prod,
//? so it must stay external — bundling it in would duplicate code and break
//? packages that rely on their own package.json / native bindings (e.g. sharp,
//? prisma, socket.io).
const dependencyNames = [
  ...Object.keys(packageJson.dependencies ?? {}),
  ...Object.keys(packageJson.devDependencies ?? {}),
];

const nodeBuiltins = builtinModules.flatMap((moduleName) => {
  const normalized = moduleName.replace(/^node:/, '');
  return [normalized, `node:${normalized}`];
});

//? Optional peer-deps that some `@luckystack/*` adapters reach behind a runtime
//? `require.resolve` guard + dynamic `import()`. They may not be installed; mark
//? them external so the bundle builds regardless of which adapters are wired.
const optionalPeerDeps = [
  'nodemailer', 'resend',
  '@sentry/node', 'dd-trace', 'hot-shots', 'posthog-node',
  '@luckystack/secret-manager', '@luckystack/email',
  // Runtime-native Drizzle SQLite branch; Node must not try to resolve it.
  'bun:sqlite',
];

const external = [...new Set([...dependencyNames, ...nodeBuiltins, ...optionalPeerDeps])];

//? Source maps are OFF by default: shipping `dist/server.js.map` beside the
//? bundle leaks the full readable server source (a source-disclosure risk if a
//? consumer ever wires real dist/-rooted static serving). Opt in for local
//? debugging with `BUNDLE_SERVER_SOURCEMAP=1`; production builds stay map-free.
const enableSourcemap = process.env.BUNDLE_SERVER_SOURCEMAP === '1';

//? The `luckystack/` overlay is loaded DYNAMICALLY by `bootstrapLuckyStack` at
//? runtime (it walks the folder and imports raw `.ts` files). That works under
//? tsx in dev, but the bundled server runs under plain `node`, where importing
//? a `.ts` file crashes with ERR_UNKNOWN_FILE_EXTENSION. So the bundle is built
//? from a GENERATED entry that statically imports every overlay file (esbuild
//? compiles them in) and registers an overlay loader via
//? `registerOverlayLoader` — `bootstrapLuckyStack` then skips the filesystem
//? walk. Order mirrors @luckystack/server's bootstrap (OVERLAY_ORDER +
//? index-first + alphabetical).
//?
//? The walk order is OWNED by @luckystack/server (its exported OVERLAY_ORDER)
//? and imported at build time, so the prod bundle can never drift from the
//? dev walk — a hardcoded copy here once silently dropped the `cron` slot
//? from production. The fallback list only applies when the server package
//? isn't built/installed yet (fresh checkout); a parity test keeps it in
//? lockstep with the canonical list.
const FALLBACK_OVERLAY_ORDER = ['core', 'deploy', 'login', 'email', 'sentry', 'presence', 'cron', 'docs-ui', 'server'];
const OVERLAY_ORDER = await (async () => {
  try {
    const server = await import('@luckystack/server');
    if (Array.isArray(server.OVERLAY_ORDER) && server.OVERLAY_ORDER.length > 0) {
      return server.OVERLAY_ORDER;
    }
  } catch {
    // not built/installed yet — the parity-tested fallback below applies
  }
  return FALLBACK_OVERLAY_ORDER;
})();

const collectOverlayFiles = (overlayAbs) => {
  const files = [];
  if (!fs.existsSync(overlayAbs)) return files;
  for (const packageName of OVERLAY_ORDER) {
    const packageDir = path.join(overlayAbs, packageName);
    if (!fs.existsSync(packageDir)) continue;
    const entries = fs.readdirSync(packageDir).sort();
    const indexEntries = entries.filter((entry) => entry === 'index.ts' || entry === 'index.js');
    const restEntries = entries.filter(
      (entry) => !indexEntries.includes(entry) && (entry.endsWith('.ts') || entry.endsWith('.js')),
    );
    for (const entry of [...indexEntries, ...restEntries]) {
      files.push(path.join(packageDir, entry));
    }
  }
  return files;
};

const writeBundleEntry = () => {
  const entryDir = path.join(root, 'node_modules', '.luckystack');
  fs.mkdirSync(entryDir, { recursive: true });
  const entryFile = path.join(entryDir, 'bundleServerEntry.mjs');
  const toEntryRelative = (absolutePath) =>
    path.relative(entryDir, absolutePath).replaceAll('\\', '/');
  const overlayFiles = collectOverlayFiles(path.join(root, 'luckystack'));
  const lines = ['// GENERATED by scripts/bundleServer.mjs — do not edit.'];
  if (overlayFiles.length > 0) {
    lines.push(
      "import { registerOverlayLoader } from '@luckystack/server';",
      'registerOverlayLoader(async () => {',
      ...overlayFiles.map((file) => `  await import('${toEntryRelative(file)}');`),
      '});',
    );
  }
  lines.push(`await import('${toEntryRelative(path.join(root, 'server/server.ts'))}');`, '');
  fs.writeFileSync(entryFile, lines.join('\n'));
  return entryFile;
};

build({
  entryPoints: [writeBundleEntry()],
  outfile: 'dist/server.js',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  sourcemap: enableSourcemap,
  external,
  logLevel: 'info',
}).catch((error) => {
  console.error('Server bundle failed:', error);
  process.exit(1);
});
