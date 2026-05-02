import type { Server as HttpServer } from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import {
  allowedOrigin,
  attachSocketRedisAdapter,
  setIoInstance,
  socketEventNames,
  buildJoinRoomResponseEventName,
  buildLeaveRoomResponseEventName,
  buildGetJoinedRoomsResponseEventName,
  extractTokenFromSocket,
  getProjectConfig,
  type apiMessage,
  type syncMessage,
  type BaseSessionLayout,
} from '@luckystack/core';
import { handleApiRequest } from '@luckystack/api';
import { handleSyncRequest } from '@luckystack/sync';
import { getSession, saveSession } from '@luckystack/login';
import {
  initAcitivityBroadcaster,
  socketConnected,
  socketDisconnecting,
  socketLeaveRoom,
} from '@luckystack/presence';

//? Per-token lock to serialize session mutations (prevents read-modify-write races
//? when multiple room joins/leaves arrive in quick succession from the same socket).
const sessionLocks = new Map<string, Promise<void>>();
const withSessionLock = async (token: string, fn: () => Promise<void>) => {
  const prev = sessionLocks.get(token) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  sessionLocks.set(token, next);
  try {
    await next;
  } finally {
    if (sessionLocks.get(token) === next) sessionLocks.delete(token);
  }
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

export const loadSocket = (httpServer: HttpServer, options: LoadSocketOptions = {}): SocketIOServer => {
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
    maxHttpBufferSize: options.maxHttpBufferSize ?? 5 * 1024 * 1024,
  });

  setIoInstance(io);

  //? Redis adapter so room broadcasts fan out across instances. Required for
  //? split/fallback deployments; safe overhead in single-instance deploys.
  attachSocketRedisAdapter(io);

  if (shouldLogSocketStartup) {
    console.log('SocketIO server initialized (redis adapter attached)');
  }

  io.on(socketEventNames.connect, (socket) => {
    const token = extractTokenFromSocket(socket);

    if (token) {
      socketConnected({ token, io });
    }

    socket.on(socketEventNames.apiRequest, (msg: apiMessage) => {
      void handleApiRequest({ msg, socket, token });
    });

    socket.on(socketEventNames.sync, (msg: syncMessage) => {
      void handleSyncRequest({ msg, socket, token });
    });

    socket.on(socketEventNames.joinRoom, (data: { group?: string; responseIndex?: number }) => {
      const group = typeof data?.group === 'string' ? data.group.trim() : '';
      const responseIndex = data?.responseIndex;
      if (typeof responseIndex !== 'number') return;

      if (!token) {
        socket.emit(buildJoinRoomResponseEventName(responseIndex), { error: 'Not authenticated' });
        return;
      }
      if (!group) {
        socket.emit(buildJoinRoomResponseEventName(responseIndex), { error: 'Invalid room' });
        return;
      }

      void withSessionLock(token, async () => {
        const session = await getSession(token);
        if (!session) {
          socket.emit(buildJoinRoomResponseEventName(responseIndex), { error: 'Session not found' });
          return;
        }

        const existingRoomCodes = getSessionRoomCodes(session);
        const nextRoomCodes = [...new Set([...existingRoomCodes, group])];

        await socket.join(group);
        const sanitizedSession = sanitizeSessionRoomKeys(session);
        await saveSession(token, { ...sanitizedSession, roomCodes: nextRoomCodes });
        socket.emit(buildJoinRoomResponseEventName(responseIndex), {
          rooms: getVisibleSocketRooms(socket, token),
        });
        if (shouldLogDev) {
          console.log(`Socket ${socket.id} joined group ${group}`);
        }
      });
    });

    socket.on(socketEventNames.leaveRoom, (data: { group?: string; responseIndex?: number }) => {
      const group = typeof data?.group === 'string' ? data.group.trim() : '';
      const responseIndex = data?.responseIndex;
      if (typeof responseIndex !== 'number') return;

      if (!token) {
        socket.emit(buildLeaveRoomResponseEventName(responseIndex), { error: 'Not authenticated' });
        return;
      }
      if (!group) {
        socket.emit(buildLeaveRoomResponseEventName(responseIndex), { error: 'Invalid room' });
        return;
      }

      void withSessionLock(token, async () => {
        const session = await getSession(token);
        if (!session) {
          socket.emit(buildLeaveRoomResponseEventName(responseIndex), { error: 'Session not found' });
          return;
        }

        const existingRoomCodes = getSessionRoomCodes(session);
        const nextRoomCodes = existingRoomCodes.filter((roomCode) => roomCode !== group);

        await socket.leave(group);
        const sanitizedSession = sanitizeSessionRoomKeys(session);
        await saveSession(token, { ...sanitizedSession, roomCodes: nextRoomCodes });

        socket.emit(buildLeaveRoomResponseEventName(responseIndex), {
          rooms: getVisibleSocketRooms(socket, token),
        });
        if (shouldLogDev) {
          console.log(`Socket ${socket.id} left group ${group}`);
        }
      });
    });

    socket.on(socketEventNames.getJoinedRooms, (data: { responseIndex?: number }) => {
      const responseIndex = data?.responseIndex;
      if (typeof responseIndex !== 'number') return;

      if (!token) {
        socket.emit(buildGetJoinedRoomsResponseEventName(responseIndex), {
          error: 'Not authenticated',
          rooms: [],
        });
        return;
      }

      socket.emit(buildGetJoinedRoomsResponseEventName(responseIndex), {
        rooms: getVisibleSocketRooms(socket, token),
      });
    });

    socket.on(socketEventNames.disconnect, (reason: string) => {
      const activityEnabled = getProjectConfig().socketActivityBroadcaster ?? false;
      if (activityEnabled && token) {
        socketDisconnecting({ token, socket, reason });
      } else {
        if (!token) return;
        if (shouldLogDev) {
          console.log(`user disconnected, reason: ${reason}`);
        }
      }
    });

    socket.on(
      socketEventNames.updateLocation,
      (newLocation: { pathName: string; searchParams?: Record<string, string> }) => {
        if (!token) return;
        const locationEnabled = getProjectConfig().locationProviderEnabled ?? false;
        if (!locationEnabled) return;
        if (shouldLogDev) {
          console.log('updating location to:', newLocation.pathName);
        }

        void withSessionLock(token, async () => {
          let returnedUser: BaseSessionLayout | null = null;
          const activityEnabled = getProjectConfig().socketActivityBroadcaster ?? false;
          if (activityEnabled) {
            returnedUser = await socketLeaveRoom({ token, socket, newPath: newLocation.pathName });
          }

          if (!newLocation) return;
          const user = returnedUser || (await getSession(token));
          if (!user) return;

          const extendedUser = user as BaseSessionLayout & { location?: typeof newLocation };
          extendedUser.location = newLocation;
          await saveSession(token, user);
        });
      }
    );

    if (getProjectConfig().socketActivityBroadcaster && token) {
      initAcitivityBroadcaster({ socket, token });
    }

    if (token) {
      void socket.join(token);
    }
  });

  return io;
};
