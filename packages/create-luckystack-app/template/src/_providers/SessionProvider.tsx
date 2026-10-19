/* eslint-disable react-refresh/only-export-components */
//? Project-side SessionProvider: owns the fetch + socket lifecycle for
//? the current session and writes into the framework's `SessionContext`
//? (from `@luckystack/core/client`). Framework components consume the
//? session via `useSession()` from the same module — that hook reads
//? this context. The provider also mirrors the active session into
//? `setLatestSession()` so non-React code (notify, language source) can
//? read it.

import { useState, ReactNode, useEffect, useMemo } from 'react';

import { apiRequest } from 'src/_sockets/apiRequest';
import { socket, useSocket } from 'src/_sockets/socketInitializer';
import {
  SessionContext,
  setLatestSession,
  proposeLogin,
  getCurrentSession as coreGetCurrentSession,
  socketEventNames,
  tryCatch,
} from '@luckystack/core/client';

import { dev, pageTitle, SessionLayout } from 'config';

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionLayout | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  useSocket(session); //? starts the socket connection

  //? Commit through the vetoable `proposeLogin` entry point so any
  //? registered `preLogin` client hook can abort (suspended account,
  //? feature-flag gate, geo block). Roll local state back to `null` on
  //? veto so the UI doesn't render half-logged-in.
  useEffect(() => {
    if (session === null) {
      setLatestSession(null);
      return;
    }
    const run = { cancelled: false };
    void (async () => {
      const result = await proposeLogin(session);
      if (run.cancelled) return;
      if (!result.committed) {
        if (dev) console.warn('[session] preLogin hook vetoed transition', result.signal);
        setSession(null);
      }
    })();
    return () => { run.cancelled = true; };
  }, [session]);

  //? Hook in client-side error-tracking user context here if you want
  //? Sentry breadcrumbs / issues to know which user they belong to.
  //? `@luckystack/error-tracking` ships server-side (`@sentry/node`).
  //? For browser reporting install `@sentry/react` separately and call
  //? `Sentry.setUser({ id: session.id, email: session.email })` in this
  //? effect.

  useEffect(() => {
    if (dev && session?.email) {
      document.title = `[DEV] ${session.email} - ${pageTitle}`;
      return;
    }
    document.title = dev ? `[DEV] ${pageTitle}` : pageTitle;
  }, [session?.email]);

  //? Resolves the initial session with retry-with-backoff. A single failed
  //? fetch (rate limit during an HMR burst, backend restart, network blip)
  //? used to leave `sessionLoaded` false for good: Middleware then waited 5s on
  //? every guarded navigation and sent a signed-in user to /login until a full
  //? reload. Now a success (even with a null result = anonymous) marks loaded
  //? at once; errors retry with exponential backoff (~7.5s in total) and the
  //? session is marked loaded either way.
  useEffect(() => {
    const run = { cancelled: false };
    void (async () => {
      const maxAttempts = 5;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const response = await apiRequest({ name: 'system/session', version: 'v1' });
        if (run.cancelled) return;

        //? Discriminate on the success branch before reading `.result`: on the
        //? raw union the error branch's `[key: string]: unknown` widens `.result`
        //? to `{}` (a tsc error).
        if (response.status === 'success') {
          if (response.result) setSession(response.result);
          setSessionLoaded(true);
          return;
        }

        if (dev) {
          console.warn(`[session] system/session attempt ${String(attempt)}/${String(maxAttempts)} failed`, response);
        }
        if (attempt === maxAttempts) break;
        const delay = Math.min(500 * 2 ** (attempt - 1), 4000);
        await new Promise<void>((resolve) => { setTimeout(resolve, delay); });
      }
      if (!run.cancelled) setSessionLoaded(true);
    })();
    return () => { run.cancelled = true; };
  }, []);

  useEffect(() => {
    if (!socket) return;

    const handler = (data: string) => {
      //? Never raw `JSON.parse`: a malformed payload would throw inside the
      //? socket listener. Parse once through `tryCatch` and bail on error.
      //? `void (async …)()` keeps the `.on` callback itself synchronous.
      void (async () => {
        const [error, parsed] = await tryCatch<SessionLayout>(() => JSON.parse(data) as SessionLayout);
        if (error || !parsed) {
          if (dev) console.warn('[session] updateSession: malformed payload', error);
          return;
        }
        if (dev) { console.log('updateSession', parsed); }
        setSession(prev => {
          if (!prev) return parsed;
          return {
            ...prev,
            ...parsed,
            avatar: `${parsed.avatar}?v=${String(Date.now())}`,
          };
        });
      })();
    };

    socket.on(socketEventNames.updateSession, handler);
    return () => {
      if (!socket) return;
      socket.off(socketEventNames.updateSession, handler);
    };
  }, []);

  const contextValue = useMemo(() => ({
    session, sessionLoaded,
  }), [session, sessionLoaded]);

  return (
    <SessionContext value={contextValue}>
      {children}
    </SessionContext>
  );
}

//? Convenience re-exports so existing app code that imports `useSession`
//? or `getCurrentSession` from this file keeps working. Both ultimately
//? resolve to `@luckystack/core/client`.
export { useSession } from '@luckystack/core/client';
export const getCurrentSession = (): SessionLayout | null =>
  coreGetCurrentSession<SessionLayout>();
