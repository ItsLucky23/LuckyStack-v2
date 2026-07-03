//? One-call bootstrap helper. Auto-imports the consumer's `luckystack/`
//? overlay folder in the canonical order, then starts the server.
//?
//? The convention is documented in `docs/ARCHITECTURE_PACKAGING.md`. Each
//? overlay file calls one of the framework's `register*` functions at module
//? load (side-effect import), so by the time `createLuckyStackServer` runs
//? the registries are populated.
//?
//? Order matters because some registries depend on others (e.g. login's
//? userAdapter needs the Prisma client registered first). The framework
//? imports them in topological order.

import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { ROOT_DIR } from '@luckystack/core';
import { createLuckyStackServer } from './createServer';
import { OPTIONAL_PACKAGES, canResolve, getLogin } from './capabilities';
import type {
  CreateLuckyStackServerOptions,
  RunningLuckyStackServer,
} from './types';

export interface BootstrapLuckyStackOptions extends CreateLuckyStackServerOptions {
  /**
   * Folder name (relative to project root) that contains the overlay files.
   * Default: `luckystack`. Each subfolder mirrors a framework package and
   * holds the project's overrides for that package.
   */
  overlayRoot?: string;
  /**
   * Skip auto-loading the overlay folder. Useful for tests that build the
   * registries by hand.
   */
  skipOverlayLoad?: boolean;
}

const OVERLAY_ORDER = [
  // Core registries first — clients, paths, routing rules. Anything below
  // depends on these being in place.
  'core',
  // Deploy + services topology — needed by the router but harmless for
  // single-instance deploys.
  'deploy',
  // Auth — OAuth providers + user adapter sit on top of core.
  'login',
  // Transactional email sender registration (optional @luckystack/email).
  'email',
  // Sentry / docs-ui / presence sit on top of core but don't block boot.
  'sentry',
  'presence',
  'docs-ui',
  // Server overlay last — typically empty, but a place to wire framework
  // hooks (`registerHook('onSocketConnect', ...)` etc.) before listen().
  'server',
];

const importIfExists = async (filePath: string): Promise<void> => {
  if (!fs.existsSync(filePath)) return;
  await import(pathToFileURL(filePath).href);
};

//? Production-bundle seam. `loadOverlayFolder` imports raw `luckystack/**/*.ts`
//? files at runtime — fine under tsx in dev, but a bundled server runs under
//? plain `node`, where importing a `.ts` file is a hard crash
//? (ERR_UNKNOWN_FILE_EXTENSION). The server bundler (`scripts/bundleServer.mjs`)
//? therefore generates an entry that statically imports the overlay files
//? (so esbuild compiles them into the bundle) and registers a loader here.
//? When a loader is registered, `bootstrapLuckyStack` runs it INSTEAD of the
//? filesystem walk — same files, same order, but resolved at build time.
type OverlayLoader = () => Promise<void>;
let registeredOverlayLoader: OverlayLoader | null = null;

export const registerOverlayLoader = (loader: OverlayLoader): void => {
  registeredOverlayLoader = loader;
};

const loadOverlayFolder = async (overlayRoot: string): Promise<void> => {
  const overlayAbs = path.isAbsolute(overlayRoot)
    ? overlayRoot
    : path.join(ROOT_DIR, overlayRoot);

  if (!fs.existsSync(overlayAbs)) {
    //? No overlay folder is fine — projects can register everything from a
    //? single `config.ts` if they prefer the legacy layout.
    return;
  }

  for (const packageName of OVERLAY_ORDER) {
    const packageDir = path.join(overlayAbs, packageName);
    if (!fs.existsSync(packageDir)) continue;

    //? Load `index.ts` first if present, then any other `*.ts` files in
    //? alphabetical order. Each file is responsible for its own
    //? side-effect registration.
    const indexCandidates = ['index.ts', 'index.js'];
    for (const candidate of indexCandidates) {
      await importIfExists(path.join(packageDir, candidate));
    }

    const entries = fs.readdirSync(packageDir).toSorted();
    for (const entry of entries) {
      if (indexCandidates.includes(entry)) continue;
      if (!entry.endsWith('.ts') && !entry.endsWith('.js')) continue;
      await importIfExists(path.join(packageDir, entry));
    }
  }
};

//? Auto-detect phase (0.2.0 "install-anything-anytime"). For each optional
//? package that ships a `./register` side-effect subpath, import it so the
//? package self-wires from env WITHOUT any consumer code edit — `npm i
//? @luckystack/<pkg>` + env + restart is enough. Resolve-guarded so an absent
//? package is a silent no-op; a single register's internal failure must never
//? crash boot (register modules log their own errors). Runs BEFORE
//? `loadOverlayFolder` so a consumer overlay file (last writer) can override the
//? auto-wired defaults.
const importOptionalPackageRegisters = async (): Promise<void> => {
  for (const pkg of OPTIONAL_PACKAGES) {
    const specifier = `@luckystack/${pkg}/register`;
    if (!canResolve(specifier)) continue;
    await importIfExistsSpecifier(specifier);
  }
};

const importIfExistsSpecifier = async (specifier: string): Promise<void> => {
  try {
    await import(specifier);
  } catch {
    //? A register module that throws at load (e.g. an internal peer-dep error)
    //? should not take the whole server down — the module is responsible for
    //? logging its own failure. Boot continues with that feature degraded.
  }
};

export const bootstrapLuckyStack = async (
  options: BootstrapLuckyStackOptions = {}
): Promise<RunningLuckyStackServer> => {
  const overlayRoot = options.overlayRoot ?? 'luckystack';

  if (!options.skipOverlayLoad) {
    //? Package self-wiring first, consumer overlay second (overlay overrides).
    await importOptionalPackageRegisters();
    if (registeredOverlayLoader) {
      //? Production bundle: overlay files were compiled into the bundle and the
      //? generated entry registered this loader — never touch raw .ts on disk.
      await registeredOverlayLoader();
    } else {
      await loadOverlayFolder(overlayRoot);
    }
  }

  //? Force login to load when installed so its session provider registers into
  //? core (`registerSessionProvider`, side-effect of the package index) even in
  //? an app that never imports any `@luckystack/login` export directly. No-op
  //? when login is absent — the app runs unauthenticated.
  await getLogin();

  const server = await createLuckyStackServer(options);
  return server;
};
