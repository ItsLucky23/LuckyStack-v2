/* eslint-disable react-refresh/only-export-components */
import { useState, ReactNode, useEffect, useMemo } from 'react';

import { apiRequest } from 'src/_sockets/apiRequest';
import { socket, useSocket } from 'src/_sockets/socketInitializer';
import { setSentryUser } from 'src/_functions/sentry';
import {
  SessionContext,
  setLatestSession,
  getCurrentSession as coreGetCurrentSession,
  socketEventNames,
} from '@luckystack/core/client';

import { dev, pageTitle, SessionLayout } from '../../config';

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionLayout | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  useSocket(session); //? starts the socket connection

  useEffect(() => {
    setLatestSession(session);
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

  useEffect(() => {
    void (async () => {
      const response = await apiRequest({ name: 'system/session', version: 'v1' });
      if (!response.result) return;
      setSession(response.result);
      setSessionLoaded(true);
    })();
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
