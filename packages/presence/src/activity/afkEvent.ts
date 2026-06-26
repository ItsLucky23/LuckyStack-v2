//? Default AFK event. Registered automatically when @luckystack/presence
//? is imported (see ../index.ts). Reads its timeout from
//? `projectConfig.presence.afkTimeoutMs` — set that to 0 to disable.
//?
//? Consumers replacing this event with their own should call
//? `unregisterActivityEvent('afk')` first, then `registerActivityEvent('afk', ...)`
//? with the alternative implementation.

import { extractTokenFromSocket, getIoInstance, socketEventNames } from '@luckystack/core';

import { getPresenceConfig } from '../presenceConfig';
import { informRoomPeers } from './peerNotifier';
import { registerActivityEvent, type ActivitySample } from '../activityEvents';
import { getSharedLastActivity } from './activitySampler';
import { lastAfkFireByToken } from './state';

const fireAfkPresence = async (sample: ActivitySample): Promise<void> => {
  if (!sample.token) return;

  //? PRESENCE-5: if ANY socket belonging to this token was recently active, the
  //? user is not truly AFK — one idle tab must not mark the user AFK while
  //? another tab is still receiving activity heartbeats. Walk the local sockets
  //? and bail if another socket for this token has a fresher last-activity entry
  //? inside the AFK threshold.
  const afkTimeoutMs = getPresenceConfig().afkTimeoutMs;
  const io = getIoInstance();
  if (io) {
    //? Adapter-aware: `fetchSockets()` spans ALL instances (Redis adapter) and
    //? `getSharedLastActivity` reads the cross-instance Redis mirror — so a fresh
    //? tab for this user on ANOTHER instance correctly suppresses the AFK fire.
    //? The old local-only `io.sockets.sockets` walk missed cross-instance tabs and
    //? produced a false `userAfk` for a multi-instance user (PRESENCE-5).
    const allSockets = await io.fetchSockets();
    for (const otherSocket of allSockets) {
      if (otherSocket.id === sample.socketId) continue;
      //? Only check sockets that belong to the same user (same session token).
      if (extractTokenFromSocket(otherSocket) !== sample.token) continue;
      const otherActivity = await getSharedLastActivity(otherSocket.id);
      if (otherActivity !== undefined && sample.now - otherActivity <= afkTimeoutMs) {
        //? Another tab for this user is still active — do not mark AFK overall.
        return;
      }
    }
  }

  //? PRESENCE-4: token-level refractory prevents double-fire when the same user
  //? has two idle tabs that both pass the trigger in the same sampler tick.
  const lastFired = lastAfkFireByToken.get(sample.token) ?? 0;
  if (sample.now - lastFired < 60_000) return;
  lastAfkFireByToken.set(sample.token, sample.now);

  //? Route through `informRoomPeers` so roommates receive `{ userId, endTime }`
  //? — NEVER the raw session token — and the pre/postPresenceUpdate hooks fire
  //? with the real userId + roomCodes (resolved from the session).
  //?
  //? `time: 0` ⇒ `endTime === now` ("AFK since now"). The idle-AFK path has NO
  //? scheduled return (the user is already past `afkTimeoutMs` with no reconnect
  //? window), so emitting `now + afkTimeoutMs` here would mislead clients into a
  //? "back in ~5:00" countdown. The reconnect-window `endTime` is correct only
  //? for the tab-switch path, which passes its real grace window separately.
  await informRoomPeers({
    token: sample.token,
    event: socketEventNames.userAfk,
    extraData: { time: 0, ignoreSelf: true },
  });
};

export const registerDefaultAfkEvent = (): void => {
  registerActivityEvent('afk', {
    trigger: (sample) => {
      const timeoutMs = getPresenceConfig().afkTimeoutMs;
      if (timeoutMs <= 0) return false;
      return sample.now - sample.lastActivity > timeoutMs;
    },
    //? Reasonable default so the same idle session doesn't re-fire on
    //? every activity-tick. Consumers re-registering can override.
    //? Token-level dedup in `fireAfkPresence` provides a secondary guard for
    //? multi-tab sessions (PRESENCE-4/5).
    refractoryMs: 60_000,
    onTrigger: fireAfkPresence,
  });
};
