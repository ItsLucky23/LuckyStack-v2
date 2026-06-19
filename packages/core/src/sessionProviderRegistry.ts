//? Session-provider registry — the decoupling seam that lets `@luckystack/login`
//? be an OPTIONAL package. Historically api/sync/presence/server imported
//? `getSession`/`saveSession`/`deleteSession`/`logout` straight from
//? `@luckystack/login`, which made login a hard transitive dependency of the
//? whole stack. Now login REGISTERS its session implementation here at boot and
//? everyone else reads sessions through the null-safe accessors below.
//?
//? When login is absent (no provider registered) the app is by definition
//? UNAUTHENTICATED: reads return `null`, writes are no-ops, logout is a no-op.
//? Callers already handle a null session (they treat it as "not logged in"), so
//? auth-gated routes reject and public routes keep working.
//?
//? Resolved at call time (never captured at module load) so registration order
//? does not matter — same contract as `getProjectConfig()` / `getLogger()`.

import type { Socket } from 'socket.io';
import type { BaseSessionLayout } from './sessionTypes';

export interface SessionSaveResult {
  ok: boolean;
  errorCode?: string;
}

export interface SessionLogoutInput {
  token: string | null;
  socket?: Socket;
  userId?: string | null;
  skipSessionDelete?: boolean;
}

export interface SessionProvider {
  getSession: (token: string | null) => Promise<BaseSessionLayout | null>;
  saveSession: (
    token: string,
    data: BaseSessionLayout,
    newUser?: boolean,
    options?: { supersedeToken?: string },
  ) => Promise<SessionSaveResult>;
  deleteSession: (token: string, options?: { skipSocketLogout?: boolean }) => Promise<boolean>;
  logout: (input: SessionLogoutInput) => Promise<void>;
}

let provider: SessionProvider | null = null;

//? Called once at boot by `@luckystack/login` (side-effect in its index).
export const registerSessionProvider = (next: SessionProvider): void => {
  provider = next;
};

export const getRegisteredSessionProvider = (): SessionProvider | null => provider;

export const isSessionProviderRegistered = (): boolean => provider !== null;

//? Test-only — drop the registered provider between scenarios.
export const resetSessionProviderForTests = (): void => {
  provider = null;
};

//? Null-safe accessors. Use these everywhere outside `@luckystack/login`.
export const readSession = async (token: string | null): Promise<BaseSessionLayout | null> =>
  provider ? provider.getSession(token) : null;

/**
 * Persist a session via the registered provider, or no-op if no login provider
 * is registered (unauthenticated-app case).
 *
 * **WARNING**: when no session provider is registered, this returns `{ ok: true }`
 * as a no-op — the session is NOT actually persisted anywhere. Callers that
 * check `result.ok` before considering a user logged in will incorrectly
 * proceed as if the session was saved. This is intentional for apps that do not
 * use `@luckystack/login`, but on a partial install (login package misconfigured
 * or not yet registered) the failure is silent rather than loud.
 * Use `isSessionProviderRegistered()` at boot to verify the provider is present.
 */
export const writeSession = async (
  token: string,
  data: BaseSessionLayout,
  newUser?: boolean,
  options?: { supersedeToken?: string },
): Promise<SessionSaveResult> =>
  provider ? provider.saveSession(token, data, newUser, options) : { ok: true };

export const removeSession = async (
  token: string,
  options?: { skipSocketLogout?: boolean },
): Promise<boolean> => (provider ? provider.deleteSession(token, options) : false);

export const performLogout = async (input: SessionLogoutInput): Promise<void> => {
  if (provider) await provider.logout(input);
};
