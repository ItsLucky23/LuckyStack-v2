import { createContext, use, useState, ReactNode, useEffect } from 'react';

import { apiRequest } from 'src/_sockets/apiRequest';
import { socket, useSocket } from 'src/_sockets/socketInitializer';

import { dev, SessionLayout } from '../../config';

interface UserContextType {
  session: SessionLayout | null;
  // setSession: Dispatch<SetStateAction<SessionLayout | null>>;
  sessionLoaded: boolean;
}

let latestSession: SessionLayout | null = null;

const UserContext = createContext<UserContextType | undefined>(undefined);

export const SessionProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<SessionLayout | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  useSocket(session); //? starts the socket connection

  useEffect(() => {
    console.log('jowjowjowj');
    latestSession = session;
  }, [session])

  useEffect(() => {
    (async () => {
      const response = await apiRequest({ name: 'session' }) as SessionLayout | null;
      setSession(response);
      setSessionLoaded(true);
    })()
  }, [])

  useEffect(() => {
    if (!socket) return;

    const handler = (data: string) => {
      if (dev) { console.log('updateSession', JSON.parse(data)); }
      const parsed = JSON.parse(data) as SessionLayout;
      setSession(prev => ({
        ...(prev!),
        ...parsed,
        avatar: parsed.avatar + '?v=' + Date.now()
      }));
    }

    socket.on('updateSession', handler)

    return () => {
      if (!socket) return;
      socket.off('updateSession', handler);
    }
    
  // }, [socket])
  }, [])

  return (
    <UserContext value={{ session, sessionLoaded }}>
      {children}
    </UserContext>
  );
};

// 5. Create a custom hook for easier usage
export const useSession = () => {
  const context = use(UserContext);
  if (!context) {
    throw new Error('useSession must be used within a SessionProvider');
  }
  return context;
};

export const getCurrentSession = () => latestSession;