import type { Server } from 'socket.io';

export const disconnectTimers = new Map<string, NodeJS.Timeout>();
export const disconnectReasonsWeIgnore: string[] = ['ping timeout'];
export const disconnectReasonsWeAllow: string[] = ['transport close', 'transport error'];
export const tempDisconnectedSockets = new Set<string>();
export const clientSwitchedTab = new Set<string>();

export const getDisconnectTime = ({
  token,
  reason
}: {
  token: string,
  reason: string | undefined
}) => {
  return clientSwitchedTab.has(token)
    ? 20_000
    : (disconnectReasonsWeAllow.includes(reason ?? "NULL")
      ? 60_000
      : 2000);
};

export const ensureIo = (io?: Server | null): io is Server => {
  return io !== null && io !== undefined;
};
