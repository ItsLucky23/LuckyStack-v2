import type { Server as HttpServer } from 'node:http';
import type { Socket } from 'socket.io';
import type { Redis as RedisClient } from 'ioredis';
import { Server as SocketIOServer } from 'socket.io';
import {
  abortAllForSocket,
  abortApiByResponseIndex,
  abortSyncByCb,
  allowedOrigin,
  applySocketMiddlewares,
  attachSocketRedisAdapter,
  formatRoomName,
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

// ---------------------------------------------------------------------------
// Per-socket context passed to each per-event registrar
// ---------------------------------------------------------------------------

interface SocketContext {
  socket: Socket;
  token: string | null;
  preferredLocale: string | undefined;
  activityBroadcasterEnabled: boolean;
  locationProviderEnabled: boolean;
  shouldLogDev: boolean;
  io: SocketIOServer;
}

// ---------------------------------------------------------------------------
// Shared guard: validates the common room-mutation preconditions before the
// async locked body runs. Returns false and emits the error when invalid.
// ---------------------------------------------------------------------------

const validateRoomRequest = (
  socket: Socket,
  responseIndex: number | undefined,
  token: string | null,
  group: string,
  preferredLocale: string | undefined,
  buildResponseEventName: (idx: number) => string
): responseIndex is number => {
  if (typeof responseIndex !== 'number') return false;

  if (!token) {
    socket.emit(buildResponseEventName(responseIndex), normalizeErrorResponse({
      response: { status: 'error', errorCode: 'auth.required' },
      preferredLocale,
    }));
    return false;
  }
  if (!group || group.length > 256) {
    socket.emit(buildResponseEventName(responseIndex), normalizeErrorResponse({
      response: { status: 'error', errorCode: 'room.invalid' },
      preferredLocale,
    }));
    return false;
  }
  return true;
};

// ---------------------------------------------------------------------------
// Shared async body for room mutations (join / leave). The `mutate` callback
// performs the transport-specific operation (join or leave) and computes the
// next roomCodes array; the hook names and blocked error code differ per direction.
// ---------------------------------------------------------------------------

interface RoomMutationOptions {
  socket: Socket;
  token: string;
  group: string;
  responseIndex: number;
  preferredLocale: string | undefined;
  shouldLogDev: boolean;
  buildResponseEventName: (idx: number) => string;
  preHook: 'preRoomJoin' | 'preRoomLeave';
  postHook: 'postRoomJoin' | 'postRoomLeave';
  blockedErrorCode: string;
  logVerb: string;
  mutate: (socket: Socket, physicalRoom: string, rawGroup: string, existingRoomCodes: string[], userId: string | undefined) => Promise<string[]>;
}

const executeRoomMutation = async (opts: RoomMutationOptions): Promise<void> => {
  const {
    socket, token, group, responseIndex, preferredLocale, shouldLogDev,
    buildResponseEventName, preHook, postHook, blockedErrorCode, logVerb, mutate,
  } = opts;

  const session = await readSession(token);
  if (!session) {
    socket.emit(buildResponseEventName(responseIndex), normalizeErrorResponse({
      response: { status: 'error', errorCode: 'session.notFound' },
      preferredLocale,
    }));
    return;
  }

  const preResult = await dispatchHook(preHook, { token, room: group });
  if (preResult.stopped) {
    socket.emit(buildResponseEventName(responseIndex), normalizeErrorResponse({
      response: {
        status: 'error',
        errorCode: preResult.signal.errorCode || blockedErrorCode,
      },
      preferredLocale,
      userLanguage: session.language,
    }));
    return;
  }

  const existingRoomCodes = getSessionRoomCodes(session);
  //? Route the raw room code through the core room-name formatter so a
  //? non-identity `registerRoomNameFormatter` (e.g. per-tenant prefixing) applies
  //? to the socket.io room name the socket physically joins/leaves. The session
  //? stores the RAW code; only the Socket.io room name uses the physical form.
  const roomPurpose = preHook === 'preRoomJoin' ? 'join' as const : 'leave' as const;
  const physicalRoom = formatRoomName(group, { purpose: roomPurpose, userId: session.id });
  const nextRoomCodes = await mutate(socket, physicalRoom, group, existingRoomCodes, session.id);

  const sanitizedSession = sanitizeSessionRoomKeys(session);
  await writeSession(token, { ...sanitizedSession, roomCodes: nextRoomCodes });

  const visibleRooms = getVisibleSocketRooms(socket, token);
  socket.emit(buildResponseEventName(responseIndex), { rooms: visibleRooms });
  if (shouldLogDev) {
    getLogger().debug(`Socket ${socket.id} ${logVerb} group ${group}`);
  }

  void dispatchHook(postHook, { token, room: group, allRooms: visibleRooms });
};

// ---------------------------------------------------------------------------
// Per-event registrar helpers
// ---------------------------------------------------------------------------

const registerApiAndSyncEvents = (ctx: SocketContext): void => {
  const { socket, token } = ctx;

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
};

const registerCancellationEvents = (ctx: SocketContext): void => {
  const { socket } = ctx;

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
};

const registerRoomEvents = (ctx: SocketContext): void => {
  const { socket, token, preferredLocale, shouldLogDev } = ctx;

  socket.on(socketEventNames.joinRoom, (data: { group?: string; responseIndex?: number }) => {
    const group = typeof data.group === 'string' ? data.group.trim() : '';
    const responseIndex = data.responseIndex;

    if (!validateRoomRequest(socket, responseIndex, token, group, preferredLocale, buildJoinRoomResponseEventName)) return;
    // validateRoomRequest already rejects null tokens, so this guard is redundant but narrows the type
    if (!token) return;

    void withSessionLock(token, async () => {
      await executeRoomMutation({
        socket,
        token,
        group,
        responseIndex,
        preferredLocale,
        shouldLogDev,
        buildResponseEventName: buildJoinRoomResponseEventName,
        preHook: 'preRoomJoin',
        postHook: 'postRoomJoin',
        blockedErrorCode: 'room.joinBlocked',
        logVerb: 'joined',
        mutate: async (sock, physicalRoom, rawGroup, existingCodes, userId) => {
          //? Enforce the per-session room cap (socket.maxRoomsPerSession, default
          //? 50) with FIFO eviction: joining a NEW room beyond the cap leaves the
          //? OLDEST joined room first, so `roomCodes` can't grow unbounded in Redis
          //? (session-bloat DoS). Re-joining an already-joined room never grows the
          //? set, so it never evicts.
          const maxRooms = getProjectConfig().socket.maxRoomsPerSession;
          let kept = existingCodes;
          if (maxRooms !== false && maxRooms > 0 && !existingCodes.includes(rawGroup)) {
            while (kept.length >= maxRooms) {
              const oldest = kept[0];
              kept = kept.slice(1);
              await sock.leave(formatRoomName(oldest, { purpose: 'join', userId }));
            }
          }
          await sock.join(physicalRoom);
          return [...new Set([...kept, rawGroup])];
        },
      });
    });
  });

  socket.on(socketEventNames.leaveRoom, (data: { group?: string; responseIndex?: number }) => {
    const group = typeof data.group === 'string' ? data.group.trim() : '';
    const responseIndex = data.responseIndex;

    if (!validateRoomRequest(socket, responseIndex, token, group, preferredLocale, buildLeaveRoomResponseEventName)) return;
    // validateRoomRequest already rejects null tokens, so this guard is redundant but narrows the type
    if (!token) return;

    void withSessionLock(token, async () => {
      await executeRoomMutation({
        socket,
        token,
        group,
        responseIndex,
        preferredLocale,
        shouldLogDev,
        buildResponseEventName: buildLeaveRoomResponseEventName,
        preHook: 'preRoomLeave',
        postHook: 'postRoomLeave',
        blockedErrorCode: 'room.leaveBlocked',
        logVerb: 'left',
        mutate: async (sock, physicalRoom, rawGroup, existingCodes, _userId) => {
          const nextCodes = existingCodes.filter((c) => c !== rawGroup);
          await sock.leave(physicalRoom);
          return nextCodes;
        },
      });
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
};

const registerDisconnectEvent = (ctx: SocketContext): void => {
  const { socket, token, activityBroadcasterEnabled, shouldLogDev } = ctx;

  socket.on(socketEventNames.disconnect, (reason: string) => {
    //? B1 — safety-net sweep. Per-request handlers also register their
    //? own `socket.once(disconnect, ...)` listeners that abort + clean up,
    //? but `abortAllForSocket` covers anything that slipped through (e.g.
    //? handler crashed before registering its disconnect listener).
    abortAllForSocket(socket.id);
    void dispatchHook('onSocketDisconnect', { socketId: socket.id, token, reason });

    if (activityBroadcasterEnabled) {
      //? Pass the token so presence can clear the token-level AFK refractory entry
      //? once the last socket for that token leaves — without it, lastAfkFireByToken
      //? grew unbounded (one stale entry per token that ever went AFK).
      void getPresence().then((presence) => { presence?.clearActivity(socket.id, token ?? undefined); });
    }

    if (activityBroadcasterEnabled && token) {
      void (async () => {
        const presence = await getPresence();
        if (presence) presence.socketDisconnecting({ token, socket, reason });
      })();
    } else {
      if (!token) return;
      if (shouldLogDev) {
        getLogger().debug(`user disconnected`, { reason });
      }
    }
  });
};

const registerUpdateLocationEvent = (ctx: SocketContext): void => {
  const { socket, token, activityBroadcasterEnabled, locationProviderEnabled, shouldLogDev } = ctx;

  socket.on(
    socketEventNames.updateLocation,
    (newLocation: { pathName: string; searchParams?: Record<string, string> }) => {
      if (!token) return;
      if (!locationProviderEnabled) return;
      //? SEC: validate client-supplied location fields before persisting in session.
      //? pathName must start with '/', be at most 2048 chars, and contain no
      //? null bytes. searchParams keys + values are capped to prevent session bloat.
      if (
        typeof newLocation.pathName !== 'string'
        || !newLocation.pathName.startsWith('/')
        || newLocation.pathName.length > 2048
        || newLocation.pathName.includes('\0')
      ) return;
      if (newLocation.searchParams !== undefined) {
        if (typeof newLocation.searchParams !== 'object' || Array.isArray(newLocation.searchParams)) return;
        const entries = Object.entries(newLocation.searchParams);
        if (entries.length > 50) return;
        for (const [k, v] of entries) {
          if (typeof k !== 'string' || k.length > 256 || typeof v !== 'string' || v.length > 1024) return;
        }
      }
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
        //? Spread into a fresh object (no in-place mutation) and sanitize
        //? legacy `code`/`codes` keys — same hygiene as the join/leave paths.
        const sanitizedUser = sanitizeSessionRoomKeys({ ...extendedUser, location: newLocation });
        await writeSession(token, sanitizedUser);

        void dispatchHook('onLocationUpdate', { token, oldLocation, newLocation });
      });
    }
  );
};

const registerActivityEvents = (ctx: SocketContext): void => {
  const { socket, token, activityBroadcasterEnabled, io } = ctx;

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
};

const rejoinPersistedRooms = (ctx: SocketContext): void => {
  const { socket, token, shouldLogDev } = ctx;

  if (!token) return;

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
      //? The token room is a private identity room (not a user-visible room code),
      //? so it is NOT routed through the room-name formatter.
      await socket.join(token);
      const session = await readSession(token);
      const roomCodes = session ? getSessionRoomCodes(session) : [];
      const userId = session?.id ?? null;
      for (const roomCode of roomCodes) {
        //? Route through the formatter so a multi-tenant prefix applies on
        //? reconnect exactly as it did on the original join (PRESENCE-1).
        await socket.join(formatRoomName(roomCode, { purpose: 'join', userId }));
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
};

export const loadSocket = (httpServer: HttpServer, options: LoadSocketOptions = {}): LoadSocketResult => {
  const config = getProjectConfig();
  const shouldLogDev = config.logging.devLogs;
  const shouldLogSocketStartup = config.logging.socketStartup;

  const io = new SocketIOServer(httpServer, {
    cors: {
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      origin: (origin, callback) => {
        //? CORS does not apply to same-origin requests, and browsers omit the
        //? `Origin` header entirely on a same-origin GET — which is exactly
        //? what the initial Socket.io polling handshake is in BOTH supported
        //? topologies: dev (Vite dev server on :5173 proxying to the backend)
        //? and prod-with-router (the @luckystack/router serves the frontend and
        //? backend from one origin). Socket.io *must* complete that origin-less
        //? HTTP handshake before it can upgrade to WebSocket, so rejecting an
        //? absent Origin here — as this layer did before — returned
        //? `400 {"code":3,"message":"Bad request"}` (engine.io's
        //? `MIDDLEWARE_FAILURE`) and broke every fresh connection.
        //?
        //? The security rationale that used to gate this ("the CORS layer is
        //? the last browser-origin gate on the WS path") was misplaced: this
        //? callback also fires on the plain-HTTP polling handshake, and an
        //? absent Origin there is the *same-origin browser* signal, not a
        //? CSRF vector. The real auth gate is the session token extracted from
        //? the handshake (`extractTokenFromSocket`) + the auth hooks, which run
        //? regardless of the Origin header. `allowOriginless` is kept for
        //? symmetry/documented opt-in but no longer gates the handshake.
        //?
        //? THREAT MODEL: non-browser callers (CLI tools, native apps, server-to-
        //? server) can connect without an Origin header and bypass the CORS check.
        //? Mitigation: all socket events require a valid session token; use
        //? `applySocketMiddlewares` (via `@luckystack/core`) to add an `io.use(...)`
        //? middleware that rejects connections lacking a token if authentication is
        //? required for ALL socket connections in the application.
        if (!origin) {
          callback(null, true);
          return;
        }
        if (allowedOrigin(origin)) {
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

    const ctx: SocketContext = {
      socket,
      token,
      preferredLocale,
      activityBroadcasterEnabled,
      locationProviderEnabled,
      shouldLogDev,
      io,
    };

    registerApiAndSyncEvents(ctx);
    registerCancellationEvents(ctx);
    registerRoomEvents(ctx);
    registerDisconnectEvent(ctx);
    registerUpdateLocationEvent(ctx);
    registerActivityEvents(ctx);
    rejoinPersistedRooms(ctx);
  });

  return { io, adapterClients: { pubClient, subClient } };
};
