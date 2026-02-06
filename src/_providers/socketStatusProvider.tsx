import {
  createContext,
  use,
  useState,
  ReactNode,
  Dispatch,
  SetStateAction,
} from "react";

export type SOCKETSTATUS =
  | "CONNECTED"
  | "DISCONNECTED"
  | "RECONNECTING"
  | "STARTUP";

export interface statusContent {
  status: SOCKETSTATUS;
  reconnectAttempt?: number;
  endTime?: number;
}

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

export const SocketStatusProvider = ({ children }: { children: ReactNode }) => {
  const [socketStatus, setSocketStatus] = useState({
    self: {
      status: "STARTUP" as SOCKETSTATUS,
    },
  });

  return (
    <SocketStatusContext value={{ socketStatus, setSocketStatus }}>
      {children}
    </SocketStatusContext>
  );
};

export const useSocketStatus = () => {
  const context = use(SocketStatusContext);
  if (!context) {
    throw new Error("useSocketStatus must be used within a SocketStatusProvider");
  }
  return context;
};