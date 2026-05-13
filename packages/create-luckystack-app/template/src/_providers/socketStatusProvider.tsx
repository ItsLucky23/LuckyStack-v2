/* eslint-disable react-refresh/only-export-components -- hooks colocated with provider */
import {
  createContext,
  use,
  useState,
  ReactNode,
  Dispatch,
  SetStateAction,
  useMemo,
} from "react";

import type { statusContent, SOCKETSTATUS } from "@luckystack/core/client";
export type { statusContent, SOCKETSTATUS };

interface SocketStatusContextType {
  socketStatus: {
    self: statusContent;
    [userId: string]: statusContent;
  };
  setSocketStatus: Dispatch<
    SetStateAction<{
      self: statusContent;
      [userId: string]: statusContent;
    }>
  >;
}

const SocketStatusContext = createContext<SocketStatusContextType | undefined>(
  undefined
);

export function SocketStatusProvider({ children }: { children: ReactNode }) {
  const [socketStatus, setSocketStatus] = useState({
    self: {
      status: "STARTUP" as SOCKETSTATUS,
    },
  });

  const contextValue = useMemo(() => ({
    socketStatus, setSocketStatus
  }), [socketStatus]);

  return (
    <SocketStatusContext value={contextValue}>
      {children}
    </SocketStatusContext>
  );
}

export function useSocketStatus() {
  const context = use(SocketStatusContext);
  if (!context) {
    throw new Error("useSocketStatus must be used within a SocketStatusProvider");
  }
  return context;
}
