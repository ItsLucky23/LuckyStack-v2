import type { Server as HttpServer } from 'node:http';
import type { Redis as RedisClient } from 'ioredis';
import { Server as SocketIOServer } from 'socket.io';
import {
  abortAllForSocket,
  abortApiByResponseIndex,
  abortSyncByCb,
  allowedOrigin,
  applySocketMiddlewares,
  attachSocketRedisAdapter,
  redis,
  setIoInstance,
  socketEventNames,
  buildJoinRoomResponseEventName,
  buildLeaveRoomResponseEventName,
  buildGetJoinedRoomsResponseEventName,
  extractLanguageFromHeader,
  extractTokenFromSocket,
  getLogger,
  getProjectConfig,
  dispatchHook,
  normalizeErrorResponse,
  readSession,
  writeSession,
  tryCatch,
  type apiMessage,
  type syncMessage,
  type BaseSessionLayout,
} from '@luckystack/core';
import { handleApiRequest } from '@luckystack/api';
//? login / presence / sync are OPTIONAL peers — resolved + lazy-loaded through
//? the capability layer so the server boots + runs without them. Session reads
//? use core's `readSession`/`writeSession` (login populates the provider).
import { capabilities, getPresence, getSync } from './capabilities';

//? Per-token lock to serialize session mutations (prevents read-modify-write races
//? when multiple room joins/leaves arrive in quick succession from the same socket).
const sessionLocks = new Map<string, Promise<void>>();
const withSessionLock = async (token: string, fn: () => Promise<void>) => {
  const prev = sessionLocks.get(token) ?? Promise.resolve();
  //? Both `then` handlers point to `fn` so a previous lock failure (rejected
  //? promise) doesn't block the next caller — we want each `withSessionLock`
  //? invocation to run regardless of whether the prior one threw.
  const next = prev.then(fn, fn);
  sessionLocks.set(token, next);
  await tryCatch(() => next);
  //? Cleanup runs unconditionally — same semantics the prior `try/finally`
  //? provided. Only delete if we still own the slot (a later caller may
  //? have already overwritten it with their own `next`).
  if (sessionLocks.get(token) === next) sessionLocks.delete(token);
};

const getVisibleSocketRooms = (
  socket: { rooms: Set<string>; id: string },
  token: string | null
): string[] => {
  return [...socket.rooms]
    .filter((room): room is string => typeof room === 'string')
    .filter((room) => room !== socket.id)
    .filter((room) => !token || room !== token);
};

const getSessionRoomCodes = (session: BaseSessionLayout): string[] => {
  const roomCodes = Array.isArray(session.roomCodes)
    ? session.roomCodes.filter(
        (roomCode): roomCode is string => typeof roomCode === 'string' && roomCode.length > 0
      )
    : [];
  return [...new Set(roomCodes)];
};

const sanitizeSessionRoomKeys = (session: BaseSessionLayout): BaseSessionLayout => {
  const { code: _legacyCode, codes: _legacyCodes, ...sanitizedSession } = session as BaseSessionLayout & {
    code?: string;
    codes?: string[];
  };
  return sanitizedSession;
};

export interface LoadSocketOptions {
  maxHttpBufferSize?: number;
}

export interface LoadSocketResult {
  io: SocketIOServer;
  /**
   * The duplicated Redis pub/sub clients backing the Socket.io adapter. The
   * server bootstrap owns them so graceful shutdown can `quit()` them — they are
   * NOT closed by `io.close()` (which only tears down the engine + connections).
   * Created here (instead of letting `attachSocketRedisAdapter` duplicate
   * internally) precisely so the server holds a handle to disconnect them.
   */
  adapterClients: { pubClient: RedisClient; subClient: RedisClient };
}

export const loadSocket = (httpServer: HttpServer, options: LoadSocketOptions = {}): LoadSocketResult => {
  const config = getProjectConfig();
  const shouldLogDev = config.logging.devLogs;
  const shouldLogSocketStartup = config.logging.socketStartup;

  const io = new SocketIOServer(httpServer, {
    cors: {
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      origin: (origin, callback) => {
        if (!origin || allowedOrigin(origin)) {
          callback(null, true);
        } else {
          callback(new Error('Not allowed by CORS'));
        }
      },
      credentials: true,
    },
    maxHttpBufferSize: options.maxHttpBufferSize ?? config.socket.maxHttpBufferSize,
    pingTimeout: config.socket.pingTimeout,
    pingInterval: config.socket.pingInterval,
  });

  setIoInstance(io);

  //? Apply consumer-registered Socket.io middlewares BEFORE the connect
  //? handler is attached so they run on the handshake of every incoming
  //? socket — same contract as a direct `io.use(...)` call.
  applySocketMiddlewares(io);

  //? Redis adapter so room broadcasts fan out across instances. Required for
  //? split/fallback deployments; safe overhead in single-instance deploys.
  //? We duplicate the pub/sub clients HERE and pass them in (rather than letting
  //? `attachSocketRedisAdapter` duplicate internally) so the server bootstrap
  //? holds the handles and can `quit()` them on graceful shutdown — `io.close()`
  //? does not close these adapter connections.
  const pubClient = redis.duplicate();
  const subClient = redis.duplicate();
  attachSocketRedisAdapter(io, { pubClient, subClient });

  if (shouldLogSocketStartup) {
    getLogger().info('SocketIO server initialized (redis adapter attached)');
  }

  io.on(socketEventNames.connect, (socket) => {
    const token = extractTokenFromSocket(socket);
    //? Cache per-connection feature flags so we don't refetch the project
    //? config on every event.
    const activityBroadcasterEnabled = config.socketActivityBroadcaster ?? false;
    const locationProviderEnabled = config.locationProviderEnabled ?? false;
    //? `extractLanguageFromHeader` can return an empty string for unparseable
    //? headers — those should fall through to the next source, so keep `||`.
    /* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- see comment above */
    const preferredLocale =
      extractLanguageFromHeader(socket.handshake.headers['x-language'])
      || extractLanguageFromHeader(socket.handshake.headers['accept-language'])
      || undefined;
    /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */

    if (token && capabilities.presence) {
      void (async () => {
        const presence = await getPresence();
        if (presence) await presence.socketConnected({ token, io });
      })();
    }

    void dispatchHook('onSocketConnect', {
      socketId: socket.id,
      token,
      ip: socket.handshake.address,
    });

    socket.on(socketEventNames.apiRequest, (msg: apiMessage) => {
      void handleApiRequest({ msg, socket, token });
    });

    //? Only wire the sync listener when @luckystack/sync is installed. Absent =>
    //? clients that emit `sync` get no handler (their request times out / the
    //? HTTP fallback returns `sync.disabled`). Lazy-loaded once on first event.
    if (capabilities.sync) {
      socket.on(socketEventNames.sync, (msg: syncMessage) => {
        void (async () => {
          const sync = await getSync();
          if (sync) await sync.handleSyncRequest({ msg, socket, token });
        })();
      });
    }

    //? B1 — cancellation events. Client emits `{ cb }` (sync) or
    //? `{ responseIndex }` (api) on the matching cancel channel; we look up
    //? the in-flight AbortController by `${socket.id}:<key>` and abort it.
    //? Server-side handler chains gate further chunk emits on the signal
    //? and exit early via the cleanup paths registered in each handler.
    socket.on(socketEventNames.syncCancel, (data: { cb?: string }) => {
      const cb = typeof data.cb === 'string' ? data.cb : null;
      if (!cb) return;
      abortSyncByCb(socket.id, cb);
    });
    socket.on(socketEventNames.apiCancel, (data: { responseIndex?: number | string }) => {
      const responseIndex = data.responseIndex;
      if (typeof responseIndex !== 'number' && typeof responseIndex !== 'string') return;
      abortApiByResponseIndex(socket.id, responseIndex);
    });

    socket.on(socketEventNames.joinRoom, (data: { group?: string; responseIndex?: number }) => {
      const group = typeof data.group === 'string' ? data.group.trim() : '';
      const responseIndex = data.responseIndex;
      if (typeof responseIndex !== 'number') return;

      if (!token) {
        socket.emit(buildJoinRoomResponseEventName(responseIndex), normalizeErrorResponse({
          response: { status: 'error', errorCode: 'auth.required' },
          preferredLocale,
        }));
        return;
      }
      if (!group) {
        socket.emit(buildJoinRoomResponseEventName(responseIndex), normalizeErrorResponse({
          response: { status: 'error', errorCode: 'room.invalid' },
          preferredLocale,
        }));
        return;
      }

      void withSessionLock(token, async () => {
        const session = await readSession(token);
        if (!session) {
          socket.emit(buildJoinRoomResponseEventName(responseIndex), normalizeErrorResponse({
            response: { status: 'error', errorCode: 'session.notFound' },
            preferredLocale,
          }));
          return;
        }

        //? Allow consumers to veto a join (auth check, allowlist, ...).
        const preResult = await dispatchHook('preRoomJoin', { token, room: group });
        if (preResult.stopped) {
          socket.emit(buildJoinRoomResponseEventName(responseIndex), normalizeErrorResponse({
            response: {
              status: 'error',
              errorCode: preResult.signal.errorCode || 'room.joinBlocked',
            },
            preferredLocale,
            userLanguage: session.language,
          }));
          return;
        }

        const existingRoomCodes = getSessionRoomCodes(session);
        const nextRoomCodes = [...new Set([...existingRoomCodes, group])];

        await socket.join(group);
        const sanitizedSession = sanitizeSessionRoomKeys(session);
        await writeSession(token, { ...sanitizedSession, roomCodes: nextRoomCodes });
        const visibleRooms = getVisibleSocketRooms(socket, token);
        socket.emit(buildJoinRoomResponseEventName(responseIndex), { rooms: visibleRooms });
        if (shouldLogDev) {
          getLogger().debug(`Socket ${socket.id} joined group ${group}`);
        }

        void dispatchHook('postRoomJoin', { token, room: group, allRooms: visibleRooms });
      });
    });

    socket.on(socketEventNames.leaveRoom, (data: { group?: string; responseIndex?: number }) => {
      const group = typeof data.group === 'string' ? data.group.trim() : '';
      const responseIndex = data.responseIndex;
      if (typeof responseIndex !== 'number') return;

      if (!token) {
        socket.emit(buildLeaveRoomResponseEventName(responseIndex), normalizeErrorResponse({
          response: { status: 'error', errorCode: 'auth.required' },
          preferredLocale,
        }));
        return;
      }
      if (!group) {
        socket.emit(buildLeaveRoomResponseEventName(responseIndex), normalizeErrorResponse({
          response: { status: 'error', errorCode: 'room.invalid' },
          preferredLocale,
        }));
        return;
      }

      void withSessionLock(token, async () => {
        const session = await readSession(token);
        if (!session) {
          socket.emit(buildLeaveRoomResponseEventName(responseIndex), normalizeErrorResponse({
            response: { status: 'error', errorCode: 'session.notFound' },
            preferredLocale,
          }));
          return;
        }

        const preResult = await dispatchHook('preRoomLeave', { token, room: group });
        if (preResult.stopped) {
          socket.emit(buildLeaveRoomResponseEventName(responseIndex), normalizeErrorResponse({
            response: {
              status: 'error',
              errorCode: preResult.signal.errorCode || 'room.leaveBlocked',
            },
            preferredLocale,
            userLanguage: session.language,
          }));
          return;
        }

        const existingRoomCodes = getSessionRoomCodes(session);
        const nextRoomCodes = existingRoomCodes.filter((roomCode) => roomCode !== group);

        await socket.leave(group);
        const sanitizedSession = sanitizeSessionRoomKeys(session);
        await writeSession(token, { ...sanitizedSession, roomCodes: nextRoomCodes });

        const visibleRooms = getVisibleSocketRooms(socket, token);
        socket.emit(buildLeaveRoomResponseEventName(responseIndex), { rooms: visibleRooms });
        if (shouldLogDev) {
          getLogger().debug(`Socket ${socket.id} left group ${group}`);
        }

        void dispatchHook('postRoomLeave', { token, room: group, allRooms: visibleRooms });
      });
    });

    socket.on(socketEventNames.getJoinedRooms, (data: { responseIndex?: number }) => {
      const responseIndex = data.responseIndex;
      if (typeof responseIndex !== 'number') return;

      if (!token) {
        socket.emit(buildGetJoinedRoomsResponseEventName(responseIndex), {
          ...normalizeErrorResponse({
            response: { status: 'error', errorCode: 'auth.required' },
            preferredLocale,
          }),
          rooms: [],
        });
        return;
      }

      socket.emit(buildGetJoinedRoomsResponseEventName(responseIndex), {
        rooms: getVisibleSocketRooms(socket, token),
      });
    });

    socket.on(socketEventNames.disconnect, (reason: string) => {
      //? B1 — safety-net sweep. Per-request handlers also register their
      //? own `socket.once(disconnect, ...)` listeners that abort + clean up,
      //? but `abortAllForSocket` covers anything that slipped through (e.g.
      //? handler crashed before registering its disconnect listener).
      abortAllForSocket(socket.id);
      void dispatchHook('onSocketDisconnect', { socketId: socket.id, token, reason });

      if (activityBroadcasterEnabled) {
        void getPresence().then((presence) => { presence?.clearActivity(socket.id); });
      }

      if (activityBroadcasterEnabled && token) {
        void (async () => {
          const presence = await getPresence();
          if (presence) await presence.socketDisconnecting({ token, socket, reason });
        })();
      } else {
        if (!token) return;
        if (shouldLogDev) {
          getLogger().debug(`user disconnected`, { reason });
        }
      }
    });

    socket.on(
      socketEventNames.updateLocation,
      (newLocation: { pathName: string; searchParams?: Record<string, string> }) => {
        if (!token) return;
        if (!locationProviderEnabled) return;
        if (shouldLogDev) {
          getLogger().debug('updating location', { pathName: newLocation.pathName });
        }

        void withSessionLock(token, async () => {
          let returnedUser: BaseSessionLayout | null = null;
          if (activityBroadcasterEnabled) {
            const presence = await getPresence();
            if (presence) {
              returnedUser = await presence.socketLeaveRoom({ token, socket, newPath: newLocation.pathName });
            }
          }

          const user = returnedUser ?? (await readSession(token));
          if (!user) return;

          const extendedUser = user as BaseSessionLayout & { location?: typeof newLocation };
          const oldLocation = extendedUser.location;
          extendedUser.location = newLocation;
          await writeSession(token, user);

          void dispatchHook('onLocationUpdate', { token, oldLocation, newLocation });
        });
      }
    );

    if (activityBroadcasterEnabled && token) {
      void (async () => {
        const presence = await getPresence();
        if (presence) presence.initActivityBroadcaster({ socket, token });
      })();
    }

    //? Activity tracking (production AFK + custom activity events). Seed the
    //? socket's last-activity on connect, start the single sampler interval
    //? (idempotent), and refresh last-activity on every client heartbeat /
    //? tab-return. The sampler walks all sockets and fires registered events
    //? (built-in AFK + any consumer pause/kick events).
    if (activityBroadcasterEnabled) {
      void (async () => {
        const presence = await getPresence();
        if (!presence) return;
        presence.startActivitySampler({ io });
        presence.recordActivity(socket.id);
      })();
      socket.on(socketEventNames.activity, () => {
        void getPresence().then((presence) => { presence?.recordActivity(socket.id); });
      });
      socket.on(socketEventNames.intentionalReconnect, () => {
        void getPresence().then((presence) => { presence?.recordActivity(socket.id); });
      });
    }

    if (token) {
      //? Rebuild this session's room membership on (re)connect. Socket.io rooms
      //? are per-connection + in-memory, so a page refresh (brand-new socket) or
      //? a server restart drops them while `session.roomCodes` (persisted in
      //? Redis) still lists them. Without replaying them here the reconnected
      //? socket only sits in its private token room, so a `syncRequest` fan-out
      //? (`io.in(room).fetchSockets()`) finds zero members and returns
      //? `sync.noReceiversFound`. Sequenced (await) so membership is restored
      //? ASAP, and logged so a failed/empty rejoin is visible. Idempotent —
      //? re-joining an already-joined room is a no-op.
      void (async () => {
        const [rejoinError, codes] = await tryCatch(async () => {
          await socket.join(token);
          const session = await readSession(token);
          const roomCodes = session ? getSessionRoomCodes(session) : [];
          for (const roomCode of roomCodes) {
            await socket.join(roomCode);
          }
          return roomCodes;
        });
        if (rejoinError) {
          getLogger().warn(`socket room rejoin failed for ${socket.id}`, { error: rejoinError.message });
          return;
        }
        if (shouldLogDev) {
          getLogger().debug(`socket ${socket.id} (re)joined rooms: ${(codes ?? []).join(', ') || '(none)'}`);
        }
      })();
    }
  });

  return { io, adapterClients: { pubClient, subClient } };
};
