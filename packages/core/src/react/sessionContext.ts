//? Shared session context. Defined in core so framework-React components
//? (Middleware, Router, useSession-aware UI) can consume it without
//? pulling in app code. The consumer's `SessionProvider` (in their
//? template's `_providers/`) does the actual fetch/socket/lifecycle work
//? and writes to this context via `<SessionContext value={...}>`.
//?
//? The session shape inside the context is intentionally loose
//? (`BaseSessionLayout | null`) so app code with extended session types
//? can read it through a typed `useSession<MySession>()` cast.

import { createContext, use } from 'react';
import type { BaseSessionLayout } from '../sessionTypes';
import {
  dispatchClientHook,
  dispatchVetoableClientHook,
  type ClientHookStopSignal,
} from '../clientHookBus';

export interface SessionContextValue<TSession extends BaseSessionLayout = BaseSessionLayout> {
  session: TSession | null;
  sessionLoaded: boolean;
}

const DEFAULT_VALUE: SessionContextValue = {
  session: null,
  sessionLoaded: false,
};

export const SessionContext = createContext<SessionContextValue>(DEFAULT_VALUE);

export function useSession<TSession extends BaseSessionLayout = BaseSessionLayout>(): SessionContextValue<TSession> {
  return use(SessionContext) as SessionContextValue<TSession>;
}

//? Non-React accessor for code that runs outside the component tree
//? (e.g. notify() called from a non-component). Kept in sync with the
//? context by the consumer's SessionProvider via `setLatestSession()`.
let latestSession: BaseSessionLayout | null = null;

export const setLatestSession = (session: BaseSessionLayout | null): void => {
  const previous = latestSession;
  latestSession = session;

  //? Fire client-side lifecycle hooks on null↔non-null transitions. Covers
  //? both fresh login AND existing-session restore on page reload — both
  //? cases need the same downstream actions (room auto-join, analytics
  //? identify, etc). Same-id updates (avatar refresh, profile change) do
  //? NOT fire postLogin; if a `sessionUpdate` hook is needed later, add it
  //? as a third branch without breaking existing handlers.
  if (previous === null && session !== null) {
    dispatchClientHook('postLogin', { session });
  } else if (previous !== null && session === null) {
    dispatchClientHook('postLogout', { previousSession: previous });
  }
};

//? Caller-supplied `TSession` is used to narrow the return type at the
//? callsite (consumers extend `BaseSessionLayout`). The lint rule sees it as
//? "used once" but the parameter exists solely to surface the consumer's
//? widened session type through the read API.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- callsite-narrowing use
export const getCurrentSession = <TSession extends BaseSessionLayout = BaseSessionLayout>(): TSession | null =>
  latestSession as TSession | null;

/**
 * Vetoable entry point for committing a null → session transition (i.e. a
 * fresh login or a page-load session restore). Dispatches the `preLogin`
 * client hook to every registered handler in parallel; if any returns a
 * stop signal, the transition is aborted and `{ committed: false, signal }`
 * is returned. Otherwise, `setLatestSession(session)` runs synchronously
 * (which fires `postLogin`) and `{ committed: true }` comes back.
 *
 * Consumer's `SessionProvider` should `await` this for non-null session
 * commits and roll local React state back to `null` when a veto comes
 * through, so the UI doesn't render a half-logged-in state.
 */
export type ProposeLoginResult =
  | { stopped: false; committed: true }
  | { stopped: true; signal: ClientHookStopSignal; committed: false };

export const proposeLogin = async (
  session: BaseSessionLayout,
): Promise<ProposeLoginResult> => {
  const veto = await dispatchVetoableClientHook('preLogin', { candidateSession: session });
  if (veto.stopped) return { stopped: true, signal: veto.signal, committed: false };
  setLatestSession(session);
  return { stopped: false, committed: true };
};
