//? SERVER-ONLY error-tracker identity scope. Keep `node:async_hooks` isolated in
//? this module: the browser-safe `sentrySetup`/`tryCatchClient` path needs the
//? tracker fan-out registry, but it never needs per-request server identity.
//? Mixing both concerns in errorTrackerRegistry.ts let tsup coalesce this import
//? into a shared chunk reached by @luckystack/core/client (VA-02).
import { AsyncLocalStorage } from 'node:async_hooks';

export interface ErrorTrackerUser {
  id?: string;
  email?: string;
  username?: string;
  [key: string]: unknown;
}

//? ET-02: each request receives a mutable box so identity can be filled after
//? session lookup while remaining isolated from concurrent request scopes.
interface IdentityBox {
  user: ErrorTrackerUser | null;
}

const identityStore = new AsyncLocalStorage<IdentityBox>();

/** Open an isolated request identity scope before the first async boundary. */
export const runWithErrorTrackerIdentityScope = <T>(fn: () => T): T =>
  identityStore.run({ user: null }, fn);

/** Open an isolated scope with a user that is already known. */
export const runWithErrorTrackerIdentity = <T>(
  user: ErrorTrackerUser | null,
  fn: () => T,
): T => identityStore.run({ user }, fn);

/** Set the user inside the active request scope; no-op outside a scope. */
export const setCurrentErrorTrackerIdentity = (user: ErrorTrackerUser | null): void => {
  const box = identityStore.getStore();
  if (box) box.user = user;
};

/** Read the current request identity, or null outside a scope. */
export const getCurrentErrorTrackerIdentity = (): ErrorTrackerUser | null =>
  identityStore.getStore()?.user ?? null;

//? `getCurrentErrorTrackerIdentity()` returns null both outside a scope and for
//? an anonymous request inside one. Adapters need to tell those apart: inside a
//? scope a null user means "anonymous", and falling back to a process-global
//? user there attributes the error to whichever request set it last.
/** Whether a request identity scope is active (even when its user is anonymous). */
export const hasErrorTrackerIdentityScope = (): boolean =>
  identityStore.getStore() !== undefined;
