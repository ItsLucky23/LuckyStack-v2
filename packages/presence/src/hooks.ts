import { registerHook, type HookResult } from '@luckystack/core';
import { disconnectTimers, tempDisconnectedSockets } from './activity/state';

/**
 * Register presence's handlers on the core hook registry. Idempotent via
 * the module-level `registered` guard — safe to call from multiple entry
 * points (server startup, test setup, etc.).
 *
 * Hooks:
 * - `postLogout`: clear the disconnect timer and drop the token from
 *   `tempDisconnectedSockets`. Previously this lived inline at the top of
 *   `@luckystack/login`'s `logout()` — moving it here breaks the
 *   login → presence direct import so presence can stay a one-way dependent
 *   of login (§29 debt note).
 */
let registered = false;

export const registerPresenceHooks = (): void => {
  if (registered) return;
  registered = true;

  registerHook('postLogout', ({ token }): HookResult => {
    if (!token) return undefined;

    if (tempDisconnectedSockets.has(token)) {
      tempDisconnectedSockets.delete(token);
    }

    if (disconnectTimers.has(token)) {
      const timer = disconnectTimers.get(token);
      if (timer) {
        clearTimeout(timer);
        disconnectTimers.delete(token);
      }
    }

    return undefined;
  });
};
