/* eslint-disable react-refresh/only-export-components */
import { useState, ReactNode, useEffect, useMemo, useRef } from 'react';

import { apiRequest } from 'src/_sockets/apiRequest';
import { socket, useSocket } from 'src/_sockets/socketInitializer';
import { setSentryUser } from 'src/_functions/sentry';
import {
  SessionContext,
  setLatestSession,
  proposeLogin,
  getCurrentSession as coreGetCurrentSession,
  socketEventNames,
} from '@luckystack/core/client';

import { dev, pageTitle, SessionLayout } from '../../config';

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionLayout | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  useSocket(session); //? starts the socket connection

  //? Commit session transitions through the vetoable `proposeLogin` entry
  //? point so any registered `preLogin` client hook can abort (suspended
  //? account, feature-flag gate, geo block). On veto we roll local React
  //? state back to `null` so the UI doesn't render half-logged-in. The
  //? null → null and session → null branches stay on plain `setLatestSession`
  //? since logout isn't gated.
  //?
  //? `proposeRef` (not a `let cancelled`) for the same flow-analyzer
  //? narrowing reason documented around `cancelledRef` further down.
  const proposeRef = useRef(false);
  useEffect(() => {
    if (session === null) {
      setLatestSession(null);
      return;
    }
    proposeRef.current = false;
    void (async () => {
      const result = await proposeLogin(session);
      if (proposeRef.current) return;
      if (!result.committed) {
        if (dev) console.warn('[session] preLogin hook vetoed transition', result.signal);
        setSession(null);
      }
    })();
    return () => { proposeRef.current = true; };
  }, [session]);

  useEffect(() => {
    setSentryUser(session?.id ? {
      id: session.id,
      email: session.email || undefined,
    } : null);
  }, [session?.id, session?.email]);

  useEffect(() => {
    if (dev && session?.email) {
      document.title = `[DEV] ${session.email} - ${pageTitle}`;
      return;
    }
    document.title = dev ? `[DEV] ${pageTitle}` : pageTitle;
  }, [session?.email]);

  //? Resolves the initial session with retry-with-backoff. Crucial because a
  //? single failed fetch (rate limit during HMR burst, server restart, network
  //? blip) used to leave `sessionLoaded` permanently false, causing Middleware
  //? to time out at 5s and bounce the user to /login even though the session
  //? was still valid in Redis. Now: status==='success' (even with null result)
  //? immediately marks loaded; transient errors retry with exponential backoff
  //? up to ~7.5s total, then give up gracefully.
  //?
  //? `cancelledRef` (not a `let`) because TS narrows a local `let cancelled
  //? = false` to literal `false` for the lifetime of the async closure and
  //? the cleanup's `cancelled = true` write isn't observed by the flow
  //? analyzer — that gave us `no-unnecessary-condition` errors on every
  //? `if (cancelled)` check. A ref's `.current` is plain `boolean`.
  const cancelledRef = useRef(false);
  useEffect(() => {
    cancelledRef.current = false;
    void (async () => {
      const maxAttempts = 5;
      //? The generated `apiRequest` return type for `system/session` only
      //? exposes the `status: 'success'` branch (because that's all the API
      //? handler itself declares). At runtime, framework-level errors
      //? (rate-limit, transport, network) DO come back as
      //? `{ status: 'error', errorCode, ... }`. Widen here so the retry
      //? branch is reachable to the type checker.
      type WideSessionResponse =
        | { status: 'success'; result: SessionLayout | null }
        | { status: 'error'; errorCode?: string };
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const rawResponse = await apiRequest({ name: 'system/session', version: 'v1' });
        if (cancelledRef.current) return;
        const response = rawResponse as WideSessionResponse;

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
      if (!cancelledRef.current) setSessionLoaded(true);
    })();
    return () => { cancelledRef.current = true; };
  }, []);

  useEffect(() => {
    if (!socket) return;

    const handler = (data: string) => {
      if (dev) { console.log('updateSession', JSON.parse(data)); }
      const parsed = JSON.parse(data) as SessionLayout;
      setSession(prev => {
        if (!prev) return parsed;
        return {
          ...prev,
          ...parsed,
          avatar: `${parsed.avatar}?v=${String(Date.now())}`,
        };
      });
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

export { useSession } from '@luckystack/core/client';
export const getCurrentSession = (): SessionLayout | null =>
  coreGetCurrentSession<SessionLayout>();
