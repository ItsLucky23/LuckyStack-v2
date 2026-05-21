//? Default AFK event. Registered automatically when @luckystack/presence
//? is imported (see ../index.ts). Reads its timeout from
//? `projectConfig.presence.afkTimeoutMs` — set that to 0 to disable.
//?
//? Consumers replacing this event with their own should call
//? `unregisterActivityEvent('afk')` first, then `registerActivityEvent('afk', ...)`
//? with the alternative implementation.

import { dispatchHook, getIoInstance, socketEventNames } from '@luckystack/core';

import { getPresenceConfig } from '../presenceConfig';
import { registerActivityEvent, type ActivitySample } from '../activityEvents';

const fireAfkPresence = async (sample: ActivitySample): Promise<void> => {
  const io = getIoInstance();
  if (!io || !sample.token) return;

  await dispatchHook('prePresenceUpdate', {
    token: sample.token,
    userId: null,
    kind: 'afk',
    roomCodes: [],
  });

  //? Notify everyone in the same rooms as this token. Same emit pattern
  //? as `informRoomPeers` but without the broadcaster's runtime weight —
  //? room membership is computed once on the io adapter.
  const rooms = io.sockets.adapter.rooms;
  for (const [roomName, members] of rooms.entries()) {
    if (!members.has(sample.socketId)) continue;
    io.to(roomName).emit(socketEventNames.userAfk, { token: sample.token });
  }

  await dispatchHook('postPresenceUpdate', {
    token: sample.token,
    userId: null,
    kind: 'afk',
    roomCodes: [],
    recipientCount: -1,
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
