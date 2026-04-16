/* eslint-disable @typescript-eslint/consistent-type-definitions, @typescript-eslint/no-floating-promises, @typescript-eslint/no-unnecessary-condition */

import '../bootstrap/env';

import handleApiRequest from "./handleApiRequest";
import { getSession, saveSession } from "../functions/session";
import { Server as SocketIOServer, Socket } from 'socket.io';
import handleSyncRequest from "./handleSyncRequest";
import allowedOrigin from '../auth/checkOrigin';
import { initAcitivityBroadcaster, socketConnected, socketDisconnecting, socketLeaveRoom } from './utils/activityBroadcaster';
import { locationProviderEnabled, socketActivityBroadcaster, SessionLayout, SessionLocation } from '../../config';
import { extractTokenFromSocket } from '../utils/extractToken';

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

export interface apiMessage {
  name: string;
  data: object;
  responseIndex: number;
}

export interface syncMessage {
  name: string;
  data: object;
  cb: string;
  receiver: string;
  responseIndex?: number;
  ignoreSelf?: boolean;
}

export let ioInstance: SocketIOServer | null = null;

type RoomEventPayload = {
  group?: unknown;
  responseIndex?: unknown;
};

type ResponseIndexPayload = {
  responseIndex?: unknown;
};

const toRecord = (value: unknown): Record<string, unknown> => {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
};

const toRoomEventPayload = (value: unknown): RoomEventPayload => {
  return toRecord(value) as RoomEventPayload;
};

const toResponseIndexPayload = (value: unknown): ResponseIndexPayload => {
  return toRecord(value) as ResponseIndexPayload;
};

const isSessionLocation = (value: unknown): value is SessionLocation => {
  if (!value || typeof value !== 'object') return false;

  const record = value as Record<string, unknown>;
  return typeof record.pathName === 'string' && typeof record.searchParams === 'object' && record.searchParams !== null;
};

const getVisibleSocketRooms = (socket: Socket, token: string | null): string[] => {
  return [...socket.rooms]
    .filter((room): room is string => typeof room === 'string')
    .filter((room) => room !== socket.id)
    .filter((room) => token == null || room !== token);
};

const getSessionRoomCodes = (session: SessionLayout): string[] => {
  const roomCodes = Array.isArray(session.roomCodes)
    ? session.roomCodes.filter((roomCode): roomCode is string => typeof roomCode === 'string' && roomCode.length > 0)
    : [];

  return [...new Set(roomCodes)];
};

const sanitizeSessionRoomKeys = (session: SessionLayout): SessionLayout => {
  const sanitizedSession = { ...session } as SessionLayout & { code?: string; codes?: string[] };
  Reflect.deleteProperty(sanitizedSession, 'code');
  Reflect.deleteProperty(sanitizedSession, 'codes');
  return sanitizedSession;
};

export default function loadSocket(httpServer: ConstructorParameters<typeof SocketIOServer>[0]) {

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

  console.log('SocketIO server initialized', 'green');

  //? when a client connects to the SocketIO server we extract their token and set up event handlers
  io.on('connection', (socket) => {
    const token = extractTokenFromSocket(socket);

    if (token) {
      socketConnected({ token, io });
    }

    socket.on('apiRequest', (msg: apiMessage) => {
      void handleApiRequest({ msg, socket, token });
    });
    socket.on('sync', (msg: syncMessage) => {
      void handleSyncRequest({ msg, socket, token });
    });
    socket.on('joinRoom', async (data: unknown) => {
      const payload = toRoomEventPayload(data);
      const group = typeof payload.group === 'string' ? payload.group.trim() : '';
      const responseIndex = payload.responseIndex;
      if (typeof responseIndex !== 'number') {
        return;
      }
      if (!token) {
        socket.emit(`joinRoom-${String(responseIndex)}`, { error: 'Not authenticated' });
        return;
      }
      if (!group) {
        socket.emit(`joinRoom-${String(responseIndex)}`, { error: 'Invalid room' });
        return;
      }
      await withSessionLock(token, async () => {
        const session = await getSession(token);
        if (!session) {
          socket.emit(`joinRoom-${String(responseIndex)}`, { error: 'Session not found' });
          return;
        }

        const existingRoomCodes = getSessionRoomCodes(session);
        const nextRoomCodes = [...new Set([...existingRoomCodes, group])];

        await socket.join(group);
        const sanitizedSession = sanitizeSessionRoomKeys(session);
        await saveSession(token, { ...sanitizedSession, roomCodes: nextRoomCodes });
        socket.emit(`joinRoom-${String(responseIndex)}`, { rooms: getVisibleSocketRooms(socket, token) });
        console.log(`Socket ${socket.id} joined group ${group}`, 'cyan');
      });
    });

    socket.on('leaveRoom', async (data: unknown) => {
      const payload = toRoomEventPayload(data);
      const group = typeof payload.group === 'string' ? payload.group.trim() : '';
      const responseIndex = payload.responseIndex;
      if (typeof responseIndex !== 'number') {
        return;
      }

      if (!token) {
        socket.emit(`leaveRoom-${String(responseIndex)}`, { error: 'Not authenticated' });
        return;
      }

      if (!group) {
        socket.emit(`leaveRoom-${String(responseIndex)}`, { error: 'Invalid room' });
        return;
      }

      await withSessionLock(token, async () => {
        const session = await getSession(token);
        if (!session) {
          socket.emit(`leaveRoom-${String(responseIndex)}`, { error: 'Session not found' });
          return;
        }

        const existingRoomCodes = getSessionRoomCodes(session);
        const nextRoomCodes = existingRoomCodes.filter((roomCode) => roomCode !== group);

        await socket.leave(group);

        const sanitizedSession = sanitizeSessionRoomKeys(session);
        await saveSession(token, { ...sanitizedSession, roomCodes: nextRoomCodes });

        socket.emit(`leaveRoom-${String(responseIndex)}`, { rooms: getVisibleSocketRooms(socket, token) });
        console.log(`Socket ${socket.id} left group ${group}`, 'cyan');
      });
    });

    socket.on('getJoinedRooms', (data: unknown) => {
      const payload = toResponseIndexPayload(data);
      const responseIndex = payload.responseIndex;
      if (typeof responseIndex !== 'number') {
        return;
      }

      if (!token) {
        socket.emit(`getJoinedRooms-${String(responseIndex)}`, { error: 'Not authenticated', rooms: [] });
        return;
      }

      socket.emit(`getJoinedRooms-${String(responseIndex)}`, { rooms: getVisibleSocketRooms(socket, token) });
    });

    socket.on('disconnect', (reason: string) => {
      if (socketActivityBroadcaster && token) {
        void socketDisconnecting({ token, socket, reason });
      } else {
        if (!token) { return; }
        console.log(`user disconnected, reason: ${reason}`, 'yellow');
      }
    });

    socket.on('updateLocation', async (newLocation: unknown) => {
      if (!token) { return; }
      if (!locationProviderEnabled) { return; }

      if (!isSessionLocation(newLocation)) { return; }

      console.log('updating location to:', newLocation.pathName, 'yellow')

      await withSessionLock(token, async () => {
        let returnedUser: SessionLayout | null = null;
        if (socketActivityBroadcaster) {
          returnedUser = await socketLeaveRoom({ token, socket, newPath: newLocation.pathName });
        }

        const user = returnedUser ?? await getSession(token);
        if (!user) { return; }

        user.location = newLocation;
        await saveSession(token, user);
      });
    });

    if (socketActivityBroadcaster && token) {
      initAcitivityBroadcaster({ socket, token });
    }

    if (token) {
      void socket.join(token);
    }

  });
  return io;
}