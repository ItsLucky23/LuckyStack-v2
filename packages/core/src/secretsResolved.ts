//? Decoupled "secrets were (re)resolved" notification channel.
//?
//? A secret resolver fires `notifySecretsResolved(changedKeys)` right after it
//? overwrites `process.env` with the real values (at boot AND on rotation).
//? `@luckystack/secret-manager` fires it AUTOMATICALLY after every resolve (via
//? the global-symbol channel at the bottom of this file — no import edge, no
//? `onApplied` wiring needed).
//? Listeners then drop any client they built from the PRE-resolution env so the
//? next use rebuilds with the resolved secret.
//?
//? This is deliberately generic and lives in core with ZERO dependency on
//? secret-manager: core self-registers a Redis listener (see `redis.ts`), and
//? any other cached-client owner (a Prisma pool, an SDK client) can subscribe
//? the same way without coupling to the resolver package.

export type SecretsResolvedListener = (changedKeys: readonly string[] | undefined) => void;

const listeners = new Set<SecretsResolvedListener>();

//? Subscribe to secret-resolution events. Returns an unsubscribe function.
export const registerSecretsResolvedListener = (listener: SecretsResolvedListener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

//? Fire all listeners. `changedKeys` = the env NAMES whose value actually
//? changed (never the secret values). Omit it (`undefined`) when the caller
//? doesn't know which keys changed — listeners then treat it as "assume
//? relevant" and reset defensively.
export const notifySecretsResolved = (changedKeys?: readonly string[]): void => {
  for (const listener of listeners) {
    try {
      listener(changedKeys);
    } catch {
      //? A misbehaving listener must never break the resolve/boot path.
    }
  }
};

//? Cross-PACKAGE channel: publish THIS core instance's `notifySecretsResolved`
//? on a well-known global-symbol array so a decoupled package that must not
//? depend on `@luckystack/core` — notably `@luckystack/secret-manager`, the
//? zero-dependency resolver — can fire it right after it resolves secrets, with
//? NO import edge. An ARRAY (not a single slot) so that if the process somehow
//? has more than one `@luckystack/core` instance (dual-package / mixed src+dist
//? resolution — a real footgun that also causes the env-revert), EVERY instance's
//? redis registry gets the rebuilt client, not just the last one loaded.
const GLOBAL_LISTENERS_SYMBOL = Symbol.for('luckystack.secretsResolved.listeners');

const getGlobalSecretsResolvedListeners = (): SecretsResolvedListener[] => {
  const existing: unknown = Reflect.get(globalThis, GLOBAL_LISTENERS_SYMBOL);
  if (Array.isArray(existing)) return existing as SecretsResolvedListener[];
  const created: SecretsResolvedListener[] = [];
  Reflect.set(globalThis, GLOBAL_LISTENERS_SYMBOL, created);
  return created;
};

getGlobalSecretsResolvedListeners().push(notifySecretsResolved);
