/* eslint-disable react-refresh/only-export-components -- tells linting to not get upset for exporting a non react hook in this file */
import { createContext, use, useState, useMemo, useCallback, ReactNode } from "react";

export type AvatarStatus = 'avatar' | 'fallback';

interface AvatarContextType {
  avatarStatuses: Record<string, AvatarStatus>;
  setAvatarStatus: (key: string, status: AvatarStatus) => void;
}

const AvatarContext = createContext<AvatarContextType | null>(null);

export const AvatarProvider = ({ children }: { children: ReactNode }) => {
  const [avatarStatuses, setAvatarStatuses] = useState<Record<string, AvatarStatus>>({});

  const setAvatarStatus = useCallback((key: string, status: AvatarStatus) => {
    setAvatarStatuses(prev => ({ ...prev, [key]: status }));
  }, []);

  const contextValue = useMemo(() => ({
    avatarStatuses,
    setAvatarStatus,
  }), [avatarStatuses, setAvatarStatus]);

  return (
    <AvatarContext value={contextValue}>
      {children}
    </AvatarContext>
  );
};

export function useAvatarContext() {
  const ctx = use(AvatarContext);
  if (!ctx) throw new Error("useAvatarContext must be used within AvatarProvider");
  return ctx;
}
