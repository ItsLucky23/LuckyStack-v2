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

//? Edge-triggered: one `userAfk` per idle episode. The trigger stays true for
//? as long as the user is idle, so without this the event re-fired every
//? refractory window ("AFK since now" again, plus a fresh fan-out). An idle
//? period that began before the token's last fire was already announced; only
//? activity AFTER that fire (a newer `lastActivity`) starts a new episode.
//? Token-level, so it also stops a multi-tab user's second idle tab from
//? announcing the same episode again (PRESENCE-4).
const alreadyAnnounced = (token: string, lastActivity: number): boolean => {
  const lastFired = lastAfkFireByToken.get(token);
  return lastFired !== undefined && lastActivity <= lastFired;
};

const fireAfkPresence = async (sample: ActivitySample): Promise<void> => {
  if (!sample.token) return;
  //? Cheap local check first, so an idle socket costs no adapter round trip.
  if (alreadyAnnounced(sample.token, sample.lastActivity)) return;

  //? PRESENCE-5: if ANY socket belonging to this token was recently active, the
  //? user is not truly AFK — one idle tab must not mark the user AFK while
  //? another tab is still receiving activity heartbeats. Walk the user's
  //? sockets and bail if another one has a fresher last-activity entry inside
  //? the AFK threshold.
  const afkTimeoutMs = getPresenceConfig().afkTimeoutMs;
  const io = getIoInstance();
  if (io) {
    //? Adapter-aware: `io.in(token).fetchSockets()` spans ALL instances (Redis
    //? adapter) and `getSharedLastActivity` reads the cross-instance Redis
    //? mirror — so a fresh tab for this user on ANOTHER instance correctly
    //? suppresses the AFK fire (PRESENCE-5). Scoped to the token's private room
    //? (every socket joins it on connect): enumerating the whole cluster per
    //? idle socket made the adapter traffic grow with the square of the users.
    const userSockets = await io.in(sample.token).fetchSockets();
    for (const otherSocket of userSockets) {
      if (otherSocket.id === sample.socketId) continue;
      //? Belt-and-braces: the token room should only hold this token's sockets.
      if (extractTokenFromSocket(otherSocket) !== sample.token) continue;
      const otherActivity = await getSharedLastActivity(otherSocket.id);
      if (otherActivity !== undefined && sample.now - otherActivity <= afkTimeoutMs) {
        //? Another tab for this user is still active — do not mark AFK overall.
        return;
      }
    }
  }

  //? Re-check after the await, then claim synchronously: two idle tabs of one
  //? user passing the trigger in the same sampler tick must fire once (PRESENCE-4).
  if (alreadyAnnounced(sample.token, sample.lastActivity)) return;
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
    //? Rate-limits how often an idle socket re-runs the (cheap) episode check;
    //? the once-per-idle-episode guarantee lives in `fireAfkPresence`.
    //? Consumers re-registering can override.
    refractoryMs: 60_000,
    onTrigger: fireAfkPresence,
  });
};
