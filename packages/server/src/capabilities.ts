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

const has = (pkg: string): boolean => {
  try {
    localRequire.resolve(pkg);
    return true;
  } catch {
    return false;
  }
};

//? Resolved once at module load. `as const` so callers branch on literal booleans.
export const capabilities = {
  login: has('@luckystack/login'),
  presence: has('@luckystack/presence'),
  sync: has('@luckystack/sync'),
} as const;

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
