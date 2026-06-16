import type { Server } from 'socket.io';

import { getPresenceConfig } from '../presenceConfig';

export const disconnectTimers = new Map<string, NodeJS.Timeout>();
export const tempDisconnectedSockets = new Set<string>();
export const clientSwitchedTab = new Set<string>();

//? `disconnectReasonsWeIgnore` and `disconnectReasonsWeAllow` were removed.
//? Earlier they were `string[]` constants captured at module-load (ignored
//? `registerPresenceConfig()` overrides), then briefly switched to
//? `() => string[]` (call-shape break for any consumer using `.includes()`).
//? Both were dead-end APIs — no internal caller used them. Consumers should
//? read from `getPresenceConfig().ignoreReasons` / `.allowReasons` directly.

export const getDisconnectTime = ({
  token,
  reason
}: {
  token: string,
  reason: string | undefined
}): number => {
  const config = getPresenceConfig();
  if (clientSwitchedTab.has(token)) return config.disconnectTimers.tabSwitchMs;
  //? Guard `undefined` explicitly instead of coercing to a magic `'NULL'`
  //? string — a consumer who literally listed `'NULL'` in `allowReasons` would
  //? otherwise wrongly earn the generous transport-close window.
  if (reason === undefined) return config.disconnectTimers.defaultMs;
  if (config.allowReasons.includes(reason)) return config.disconnectTimers.transportCloseMs;
  return config.disconnectTimers.defaultMs;
};

export const ensureIo = (io?: Server | null): io is Server => {
  return io !== null && io !== undefined;
};
