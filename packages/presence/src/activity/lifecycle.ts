import { Server, Socket } from 'socket.io';

import { informRoomPeers, informRoomPeersLeft } from './peerNotifier';
import { socketLeaveRoom } from './leaveRoom';
import { tokenFingerprint } from './tokenFingerprint';
import {
  clientSwitchedTab,
  disconnectTimers,
  getDisconnectTime,
  tempDisconnectedSockets,
} from './state';
import { dispatchHook, getIoInstance, getProjectConfig, socketEventNames, getLogger, readSession, removeSession, tryCatch } from '@luckystack/core';
import { getPresenceConfig } from '../presenceConfig';

export const socketConnected = async ({
  token,
  io
}: {
  token: string,
  io: Server
}): Promise<void> => {
  //? Contain the whole reconnect path: it runs from a floating
  //? `void (async()=>…)()` IIFE in the server's `loadSocket`, so a reject
  //? (Redis/session-store blip) would otherwise become an unhandled rejection
  //? AND silently drop the reconnect hook + `userBack` fan-out. Capture instead.
  const [error] = await tryCatch(async () => {
    const timer = disconnectTimers.get(token);
    let isReconnect = false;
    if (timer) {
      isReconnect = true;
      getLogger().debug(`presence: user came back`, { tokenFingerprint: tokenFingerprint(token) });
      clearTimeout(timer);
      disconnectTimers.delete(token);
      if (tempDisconnectedSockets.has(token)) {
        tempDisconnectedSockets.delete(token);
      } else {
        getLogger().debug(`presence: user connected`, { tokenFingerprint: tokenFingerprint(token) });
      }
    }

    const session = await readSession(token);
    const userId = session?.id ?? null;
    const roomCodes = Array.isArray(session?.roomCodes)
      ? session.roomCodes.filter((room: unknown): room is string => typeof room === 'string' && room.length > 0)
      : [];

    //? `postSocketReconnect` fires only on reconnect (not on initial connect)
    //? so consumers can rehydrate state, replay missed events, or invalidate
    //? caches. Initial-connect cases are covered by the existing
    //? `onSocketConnect` hook from @luckystack/server.
    if (isReconnect) {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises -- fire-and-forget consumer hook; failures are isolated inside dispatchHook
      void dispatchHook('postSocketReconnect', {
        token,
        userId,
        roomCodes,
      });
    }

    //? Only broadcast `userBack` on an actual reconnect-within-grace, and only
    //? when the consumer enabled `socketActivityBroadcaster`. The docs contract
    //? (lifecycle.md: "cold connect = no userBack broadcast") + the package's
    //? own gate promise require both: a cold connect with persisted roomCodes must
    //? NOT fan out, and a config that left the broadcaster off must stay silent
    //? even if the server caller forgot to gate on the flag.
    if (!isReconnect) { return; }
    if (!(getProjectConfig().socketActivityBroadcaster ?? false)) { return; }
    if (roomCodes.length === 0) { return; }
    if (!userId) { return; }

    await informRoomPeers({ token, io, event: socketEventNames.userBack, extraData: { ignoreSelf: true } });
  }, undefined, { scope: 'presence.socketConnected' });

  if (error) {
    getLogger().error('presence: socketConnected failed', { tokenFingerprint: tokenFingerprint(token), error });
  }
}

//? Grace-window expiry teardown, extracted from the inline `setTimeout` body so
//? it can be wrapped in `tryCatch` (a Redis/session-store reject on this hot
//? disconnect path would otherwise be an unhandled rejection AND skip
//? `removeSession`/timer cleanup → session + timer leak, user stuck "present").
//? Cleanup of `tempDisconnectedSockets`/`disconnectTimers` runs in `finally` so
//? it is idempotent and always happens even when teardown throws.
const handleGraceExpiry = async ({
  token,
  reason,
  socket,
  timeout,
  deleteSessionOnDisconnect,
  time,
}: {
  token: string,
  reason: string,
  socket: Socket,
  timeout: NodeJS.Timeout,
  deleteSessionOnDisconnect: boolean,
  time: number,
}): Promise<void> => {
  //? Only the timer that is still the registered one for this token may run
  //? teardown; a newer disconnect (re-armed timer) supersedes this one.
  if (!tempDisconnectedSockets.has(token)) { return; }
  if (disconnectTimers.get(token) !== timeout) { return; }

  const [error] = await tryCatch(async () => {
    //? Multi-tab guard: two tabs share one session token but hold two sockets,
    //? each joined to the token's private room. Closing tab B arms this timer,
    //? but tab A is still connected — `socketConnected` never re-fires to cancel
    //? it because the session was never gone. Without this check we would leave
    //? rooms + delete the shared session out from under the live tab A. Every
    //? socket joins `socket.join(token)`, so a non-empty token room = a live tab.
    const liveSockets = getIoInstance()?.sockets.adapter.rooms.get(token)?.size ?? 0;
    if (liveSockets > 0) { return; }

    //? Resolve the session BEFORE teardown so the grace-expiry hook + any
    //? `userLeft`-style peer notification can still see the userId/roomCodes.
    const session = await readSession(token);
    const userId = session?.id ?? null;
    const roomCodes = Array.isArray(session?.roomCodes)
      ? session.roomCodes.filter((room: unknown): room is string => typeof room === 'string' && room.length > 0)
      : [];

    //? Tell the room's remaining members the peer is gone for good (MIS-003) —
    //? presence otherwise only ever emits userAfk/userBack, so a hard
    //? disconnect / grace expiry would leave the departed user shown as present
    //? forever. Gated on `socketActivityBroadcaster` (same contract as
    //? userBack/userAfk: a consumer who disabled peer fan-out stays silent), and
    //? done BEFORE `removeSession` while userId/roomCodes are still resolved.
    if (userId && roomCodes.length > 0 && (getProjectConfig().socketActivityBroadcaster ?? false)) {
      await informRoomPeersLeft({ token, userId, roomCodes, io: getIoInstance() });
    }

    await socketLeaveRoom({ token, socket, newPath: null });

    if (deleteSessionOnDisconnect) {
      await removeSession(token);
    }

    //? The "user is truly gone" injection point. Server's `onSocketDisconnect`
    //? fires immediately at disconnect (before the grace verdict); login's
    //? session-delete hooks only fire on the delete path (and never on the
    //? tab-switch path where `deleteSessionOnDisconnect` is false). This hook is
    //? the only seam that fires exactly when the grace window expires — mark
    //? offline in the DB, persist final state, audit the departure here.
    // eslint-disable-next-line @typescript-eslint/no-floating-promises -- fire-and-forget consumer hook; failures are isolated inside dispatchHook
    void dispatchHook('postDisconnectGraceExpired', {
      token,
      userId,
      roomCodes,
      reason,
      sessionDeleted: deleteSessionOnDisconnect,
    });

    getLogger().debug(`presence: user fully disconnected`, { reason, timerSeconds: time / 1000, deleteSessionOnDisconnect });
  }, undefined, { scope: 'presence.handleGraceExpiry' });

  if (error) {
    getLogger().error('presence: grace-expiry teardown failed', { tokenFingerprint: tokenFingerprint(token), reason, error });
  }

  //? Idempotent cleanup — always drop the grace-window flag + timer so a
  //? teardown reject (handled above) can never leave the token stuck in the
  //? grace set or its timer dangling in the map.
  tempDisconnectedSockets.delete(token);
  if (disconnectTimers.get(token) === timeout) {
    disconnectTimers.delete(token);
  }
};

//? Not `async`: the grace teardown now runs in a detached `setTimeout`
//? (`handleGraceExpiry`), so this function no longer awaits anything. Returns
//? `void`; the caller invokes it fire-and-forget.
export const socketDisconnecting = ({
  token,
  reason,
  socket
}: {
  token: string,
  reason: string,
  socket: Socket
}): void => {

  //? Read from the live config so `registerPresenceConfig({ ignoreReasons })`
  //? works even if it ran after this module was imported.
  if (getPresenceConfig().ignoreReasons.includes(reason)) {
    getLogger().debug(`presence: ignored disconnect`, { reason });
    //? Still consume the tab-switch flag so it can't survive an ignored
    //? disconnect and force the wrong (preserve-session) verdict on the token's
    //? NEXT disconnect — `getDisconnectTime` keys off `clientSwitchedTab.has`.
    clientSwitchedTab.delete(token);
    return;
  }

  if (!token) { return; }

  //? Capture the tab-switch verdict, THEN consume the flag, on every exit path
  //? so it never leaks: previously it was only deleted after the
  //? `tempDisconnectedSockets.has` guard below, so a multi-tab second disconnect
  //? (early return) left it set, forcing a stale preserve-session verdict on the
  //? token's next disconnect. `getDisconnectTime` also reads `clientSwitchedTab`
  //? for the window length, so resolve `time` BEFORE deleting the flag.
  const switchedTab = clientSwitchedTab.has(token);
  const time = getDisconnectTime({ token, reason });
  clientSwitchedTab.delete(token);

  if (tempDisconnectedSockets.has(token)) {
    return;
  } else {
    tempDisconnectedSockets.add(token);
  }

  const deleteSessionOnDisconnect = !switchedTab;

  getLogger().debug(`presence: user disconnected`, { reason, timerSeconds: time / 1000 });

  const timeout = setTimeout(() => {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises -- timer body is self-contained (errors captured via tryCatch inside handleGraceExpiry); nothing awaits the timer
    void handleGraceExpiry({ token, reason, socket, timeout, deleteSessionOnDisconnect, time });
  }, time);

  if (disconnectTimers.has(token)) {
    clearTimeout(disconnectTimers.get(token));
    disconnectTimers.delete(token);
  }
  disconnectTimers.set(token, timeout);

}

export const initActivityBroadcaster = ({
  token,
  socket
}: {
  token: string,
  socket: Socket,
}) => {
  //? `intentionalDisconnect` is fully client-asserted (tab-switch signal). Honour
  //? it at most once per connection so a client cannot spam `userAfk` to its own
  //? roommates by re-emitting the event. The trust model is documented in
  //? docs/disconnect-grace.md: tab-switch is best-effort, the Redis TTL is the
  //? real bound on session lifetime.
  let intentionalDisconnectHandled = false;
  // eslint-disable-next-line @typescript-eslint/no-misused-promises -- socket.io ignores the listener promise; errors are contained via tryCatch below
  socket.on(socketEventNames.intentionalDisconnect, async () => {
    if (intentionalDisconnectHandled) { return; }
    intentionalDisconnectHandled = true;

    clientSwitchedTab.add(token);
    const time = getDisconnectTime({ token, reason: undefined });

    //? Contain the fan-out: socket.io ignores listener promise rejections, so an
    //? `informRoomPeers` reject would be a client-reachable unhandled rejection.
    //? Capture it, but ALWAYS run `socket.disconnect(false)` afterwards so the
    //? tab-switch teardown can't silently break while `clientSwitchedTab` is set.
    const [error] = await tryCatch(
      async () => { await informRoomPeers({ token, event: socketEventNames.userAfk, extraData: { time } }); },
      undefined,
      { scope: 'presence.intentionalDisconnect' },
    );
    if (error) {
      getLogger().error('presence: intentionalDisconnect fan-out failed', { tokenFingerprint: tokenFingerprint(token), error });
    }

    socket.disconnect(false);
  });
}
