//? Optional-package capability layer (0.2.0). `@luckystack/login`, `presence`,
//? and `sync` are OPTIONAL peers of `@luckystack/server`. We detect each once at
//? boot via `require.resolve` (cheap, cached) and lazy-import it only when
//? present, so a consumer who omits one gets graceful degradation instead of an
//? `ERR_MODULE_NOT_FOUND` crash. Mirrors `@luckystack/error-tracking`'s resolve
//? guard. Session reads/writes do NOT go through here — they use core's
//? `readSession`/`writeSession` accessors, which login populates via the session
//? provider registry. This layer is for the ROUTE/SOCKET wiring that must be
//? conditionally registered (auth routes, the sync listener, presence lifecycle).

import { createRequire } from 'node:module';

const localRequire = createRequire(import.meta.url);

//? Detect whether an optional package (or one of its subpaths) is installed.
//?
//? IMPORTANT: every `@luckystack/*` package ships an **import-only** `exports`
//? map (`{ "import": ..., "types": ... }` — no `"require"`/`"default"`). A
//? CJS `require.resolve()` resolves with CJS conditions and therefore THROWS
//? `ERR_PACKAGE_PATH_NOT_EXPORTED` on those maps — i.e. it reports every
//? installed `@luckystack/*` package as ABSENT. We must resolve with the ESM
//? resolver (`import.meta.resolve`, which honors the `"import"` condition).
//? `createRequire().resolve` is kept only as a fallback for Node < 20.6 where
//? synchronous `import.meta.resolve` is unavailable.
const esmResolve = (import.meta as { resolve?: (specifier: string) => string }).resolve;

//? Warn once when `import.meta.resolve` is absent (Node < 20.6). The CJS
//? fallback misreports all import-only packages as absent, so optional
//? features (login, presence, sync) silently degrade. Surface this so the
//? operator can upgrade Node rather than debugging mysterious capability gaps.
let _warnedResolverMissing = false;
const warnResolverMissingOnce = (): void => {
  if (_warnedResolverMissing) return;
  _warnedResolverMissing = true;
  // eslint-disable-next-line no-console -- intentional boot diagnostic; logger not yet available
  console.warn(
    '[luckystack:capabilities] import.meta.resolve is unavailable (Node < 20.6). ' +
    'Optional package detection falls back to require.resolve, which cannot resolve ' +
    'import-only exports maps and may misreport @luckystack/* packages as absent. ' +
    'Upgrade to Node >= 20.6 to ensure correct capability detection.',
  );
};

const has = (pkg: string): boolean => {
  if (typeof esmResolve === 'function') {
    try {
      esmResolve(pkg);
      return true;
    } catch {
      return false;
    }
  }
  //? CJS fallback: `ERR_PACKAGE_PATH_NOT_EXPORTED` means the package IS
  //? installed but its exports map has no CJS condition — treat as PRESENT.
  //? Any other error (MODULE_NOT_FOUND, ERR_MODULE_NOT_FOUND) means absent.
  warnResolverMissingOnce();
  try {
    localRequire.resolve(pkg);
    return true;
  } catch (error: unknown) {
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'ERR_PACKAGE_PATH_NOT_EXPORTED') {
      return true;
    }
    return false;
  }
};

//? Resolved once at module load. `as const` so callers branch on literal booleans.
export const capabilities = {
  login: has('@luckystack/login'),
  presence: has('@luckystack/presence'),
  sync: has('@luckystack/sync'),
} as const;

//? Optional packages that ship a side-effect `@luckystack/<pkg>/register`
//? subpath. `bootstrapLuckyStack` resolve-guards + imports each one BEFORE the
//? consumer overlay folder so a hand-written overlay (last writer) still wins.
//? Each `./register` is an env-driven, idempotent no-op when its env is unset.
//? Order is topological (mirrors `OVERLAY_ORDER`). NOTES:
//?   - `sync` is excluded: it has no server-side register; its add-later wiring
//?     is the client receive bridge (`@luckystack/sync/client` attachSyncReceiver).
//?   - `secret-manager` is excluded: it is resolved explicitly in the consumer
//?     entry (fails-OPEN), not via a register subpath.
export const OPTIONAL_PACKAGES = [
  'login',
  'email',
  'error-tracking',
  'presence',
  'docs-ui',
] as const;

//? Cheap resolve guard reused by the bootstrap auto-detect loop: true when the
//? given specifier (e.g. `@luckystack/login/register`) is installed + resolvable.
export const canResolve = (specifier: string): boolean => has(specifier);

let loginMod: typeof import('@luckystack/login') | null | undefined;
export const getLogin = async (): Promise<typeof import('@luckystack/login') | null> => {
  if (loginMod !== undefined) return loginMod;
  loginMod = capabilities.login ? await import('@luckystack/login') : null;
  return loginMod;
};

let presenceMod: typeof import('@luckystack/presence') | null | undefined;
export const getPresence = async (): Promise<typeof import('@luckystack/presence') | null> => {
  if (presenceMod !== undefined) return presenceMod;
  presenceMod = capabilities.presence ? await import('@luckystack/presence') : null;
  return presenceMod;
};

let syncMod: typeof import('@luckystack/sync') | null | undefined;
export const getSync = async (): Promise<typeof import('@luckystack/sync') | null> => {
  if (syncMod !== undefined) return syncMod;
  syncMod = capabilities.sync ? await import('@luckystack/sync') : null;
  return syncMod;
};
