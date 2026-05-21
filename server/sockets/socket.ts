import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env' });
loadEnv({ path: '.env.local', override: true });

import type { Server as HttpServer } from 'node:http';

import handleApiRequest from "./handleApiRequest";
import { getSession, saveSession } from "../functions/session";
import { Server as SocketIOServer } from 'socket.io';
import handleSyncRequest from "./handleSyncRequest";
import { allowedOrigin, attachSocketRedisAdapter, setIoInstance } from '@luckystack/core';
import type { apiMessage, syncMessage, BaseSessionLayout } from '@luckystack/core';
import { initActivityBroadcaster, socketConnected, socketDisconnecting, socketLeaveRoom } from '@luckystack/presence';
import { locationProviderEnabled, logging, SessionLayout, socketActivityBroadcaster } from '../../config';
import { extractTokenFromSocket } from '../utils/extractToken';
import {
  buildGetJoinedRoomsResponseEventName,
  buildJoinRoomResponseEventName,
  buildLeaveRoomResponseEventName,
  socketEventNames,
} from '../../shared/socketEvents';

//? Per-token lock to serialize session mutations (prevents read-modify-write races)
const sessionLocks = new Map<string, Promise<void>>();
const withSessionLock = async (token: string, fn: () => Promise<void>) => {
  const prev = sessionLocks.get(token) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  sessionLocks.set(token, next);
  try { await next; } finally {
    //? Clean up if no more pending operations
    if (sessionLocks.get(token) === next) sessionLocks.delete(token);
  }
};

//? apiMessage / syncMessage types now live in @luckystack/core/socketTypes.
//? Re-exported for any existing server-side importers that haven't migrated.
export type { apiMessage, syncMessage } from '@luckystack/core';

//? ioInstance now lives in @luckystack/core. Re-exported here so existing
//? callers that `import { ioInstance } from './socket'` still work; new
//? consumers should call `getIoInstance()` from core instead.
export let ioInstance: SocketIOServer | null = null;
const shouldLogDev = logging.devLogs;
const shouldLogSocketStartup = logging.socketStartup;

//? `locationProviderEnabled` and `socketActivityBroadcaster` are narrowed to
//? literal `false as const` in the default config. Widen here so handlers
//? that check the flags don't trigger lint "always-truthy / always-falsy"
//? warnings — the flags ARE meant to be toggled per consumer.
const isLocationProviderEnabled: boolean = locationProviderEnabled;
const isSocketActivityBroadcaster: boolean = socketActivityBroadcaster;

const getVisibleSocketRooms = (
  socket: { id: string; rooms: Set<string> | Iterable<string> },
  token: string | null,
): string[] => {
  return [...socket.rooms]
    .filter((room): room is string => typeof room === 'string')
    .filter((room) => room !== socket.id)
    .filter((room) => !token || room !== token);
};

const getSessionRoomCodes = (session: BaseSessionLayout): string[] => {
  const roomCodes = Array.isArray(session.roomCodes)
    ? session.roomCodes.filter((roomCode): roomCode is string => typeof roomCode === 'string' && roomCode.length > 0)
    : [];

  return [...new Set(roomCodes)];
};

//? Strip the deprecated `code`/`codes` legacy keys before persisting a
//? session. Uses a typed delete instead of destructure-and-discard so the
//? lint rule against unused destructured names doesn't fire.
const sanitizeSessionRoomKeys = <T extends BaseSessionLayout>(session: T): T => {
  const result: T & { code?: string; codes?: string[] } = { ...session };
  delete result.code;
  delete result.codes;
  return result;
};

//? Payload shapes the framework's transport guarantees on these socket
//? events. Socket.io's `on` typing defaults to `any` — declare these so
//? handler bodies get proper narrowing without per-line casts.
interface JoinRoomPayload { group?: unknown; responseIndex?: unknown }
interface LeaveRoomPayload { group?: unknown; responseIndex?: unknown }
interface GetJoinedRoomsPayload { responseIndex?: unknown }
interface UpdateLocationPayload { pathName?: unknown }

export default function loadSocket(httpServer: HttpServer) {

  //? here we create the SocketIOServer instance
  const io = new SocketIOServer(httpServer, {
    cors: {
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      origin: (origin, callback) => {
        if (!origin || allowedOrigin(origin)) {
          callback(null, true);
        } else {
          callback(new Error('Not allowed by CORS'));
        }
      },
      credentials: true,
    },
    maxHttpBufferSize: 5 * 1024 * 1024, // 5 MB
  });

  ioInstance = io;
  setIoInstance(io);

  //? Attach Redis-backed adapter so room broadcasts fan out across every
  //? instance that shares the same Redis resource. Required for split/fallback
  //? deployments; safe no-op overhead in single-instance deploys.
  attachSocketRedisAdapter(io);

  if (shouldLogSocketStartup) {
    console.log('SocketIO server initialized (redis adapter attached)', 'green');
  }

  //? when a client connects to the SocketIO server we extract their token and set up event handlers
  io.on(socketEventNames.connect, (socket) => {
    const token = extractTokenFromSocket(socket);

    if (token) {
      void socketConnected({ token, io });
    }

    socket.on(socketEventNames.apiRequest, (msg: apiMessage) => {
      void handleApiRequest({ msg, socket, token });
    });
    socket.on(socketEventNames.sync, (msg: syncMessage) => {
      void handleSyncRequest({ msg, socket, token });
    });
    socket.on(socketEventNames.joinRoom, (data: JoinRoomPayload) => {
      const group = typeof data.group === 'string' ? data.group.trim() : '';
      const responseIndex = data.responseIndex;
      if (typeof responseIndex !== 'number') {
        return;
      }
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
        socket.emit(buildJoinRoomResponseEventName(responseIndex), { rooms: getVisibleSocketRooms(socket, token) });
        if (shouldLogDev) {
          console.log(`Socket ${socket.id} joined group ${group}`, 'cyan');
        }
      });
    });

    socket.on(socketEventNames.leaveRoom, (data: LeaveRoomPayload) => {
      const group = typeof data.group === 'string' ? data.group.trim() : '';
      const responseIndex = data.responseIndex;
      if (typeof responseIndex !== 'number') {
        return;
      }

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

        socket.emit(buildLeaveRoomResponseEventName(responseIndex), { rooms: getVisibleSocketRooms(socket, token) });
        if (shouldLogDev) {
          console.log(`Socket ${socket.id} left group ${group}`, 'cyan');
        }
      });
    });

    socket.on(socketEventNames.getJoinedRooms, (data: GetJoinedRoomsPayload) => {
      const responseIndex = data.responseIndex;
      if (typeof responseIndex !== 'number') {
        return;
      }

      if (!token) {
        socket.emit(buildGetJoinedRoomsResponseEventName(responseIndex), { error: 'Not authenticated', rooms: [] });
        return;
      }

      socket.emit(buildGetJoinedRoomsResponseEventName(responseIndex), { rooms: getVisibleSocketRooms(socket, token) });
    });

    socket.on(socketEventNames.disconnect, (reason: string) => {
      if (isSocketActivityBroadcaster && token) {
        void socketDisconnecting({ token, socket, reason });
      } else {
        if (!token) { return; }
        if (shouldLogDev) {
          console.log(`user disconnected, reason: ${reason}`, 'yellow');
        }
      }
    });

    socket.on(socketEventNames.updateLocation, (newLocation: UpdateLocationPayload) => {
      if (!token) { return; }
      if (!isLocationProviderEnabled) { return; }
      const pathName = typeof newLocation.pathName === 'string' ? newLocation.pathName : '';
      if (shouldLogDev) {
        console.log('updating location to:', pathName, 'yellow');
      }

      void withSessionLock(token, async () => {
        let returnedUser: BaseSessionLayout | null = null;
        if (isSocketActivityBroadcaster) {
          returnedUser = await socketLeaveRoom({ token, socket, newPath: pathName });
        }

        const user = returnedUser ?? await getSession(token);
        if (!user) { return; }

        const extendedUser = user as SessionLayout & { location?: { pathName: string } };

        extendedUser.location = { pathName };
        await saveSession(token, user);
      });
    });

    if (isSocketActivityBroadcaster && token) {
      initActivityBroadcaster({ socket, token });
    }

    if (token) {
      void socket.join(token);
    }

  });
  return io;
}
