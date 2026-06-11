//? Default AFK event. Registered automatically when @luckystack/presence
//? is imported (see ../index.ts). Reads its timeout from
//? `projectConfig.presence.afkTimeoutMs` — set that to 0 to disable.
//?
//? Consumers replacing this event with their own should call
//? `unregisterActivityEvent('afk')` first, then `registerActivityEvent('afk', ...)`
//? with the alternative implementation.

import { socketEventNames } from '@luckystack/core';

import { getPresenceConfig } from '../presenceConfig';
import { informRoomPeers } from './peerNotifier';
import { registerActivityEvent, type ActivitySample } from '../activityEvents';

const fireAfkPresence = async (sample: ActivitySample): Promise<void> => {
  if (!sample.token) return;

  //? Route through `informRoomPeers` so roommates receive `{ userId, endTime }`
  //? — NEVER the raw session token — and the pre/postPresenceUpdate hooks fire
  //? with the real userId + roomCodes (resolved from the session).
  await informRoomPeers({
    token: sample.token,
    event: socketEventNames.userAfk,
    extraData: { time: getPresenceConfig().afkTimeoutMs },
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
    refractoryMs: 60_000,
    onTrigger: fireAfkPresence,
  });
};
