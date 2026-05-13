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
  latestSession = session;
};

export const getCurrentSession = <TSession extends BaseSessionLayout = BaseSessionLayout>(): TSession | null =>
  latestSession as TSession | null;
