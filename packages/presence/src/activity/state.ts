import type { Server } from 'socket.io';

import { getPresenceConfig } from '../presenceConfig';

export const disconnectTimers = new Map<string, NodeJS.Timeout>();
export const tempDisconnectedSockets = new Set<string>();
export const clientSwitchedTab = new Set<string>();

//? Back-compat exports — kept so any caller that read these constants directly
//? still resolves. Internal callsites should prefer `getPresenceConfig()` so
//? per-install overrides take effect at call-time.
export const disconnectReasonsWeIgnore: string[] = getPresenceConfig().ignoreReasons;
export const disconnectReasonsWeAllow: string[] = getPresenceConfig().allowReasons;

export const getDisconnectTime = ({
  token,
  reason
}: {
  token: string,
  reason: string | undefined
}): number => {
  const config = getPresenceConfig();
  if (clientSwitchedTab.has(token)) return config.disconnectTimers.tabSwitchMs;
  if (config.allowReasons.includes(reason ?? 'NULL')) return config.disconnectTimers.transportCloseMs;
  return config.disconnectTimers.defaultMs;
};

export const ensureIo = (io?: Server | null): io is Server => {
  return io !== null && io !== undefined;
};
