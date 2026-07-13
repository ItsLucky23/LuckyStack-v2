//? Decoupled "secrets were (re)resolved" notification channel.
//?
//? A secret resolver — e.g. `@luckystack/secret-manager` via its `onApplied`
//? callback — fires `notifySecretsResolved(changedKeys)` right after it
//? overwrites `process.env` with the real values (at boot AND on rotation).
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
