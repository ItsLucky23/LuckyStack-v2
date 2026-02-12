import dotenv from 'dotenv';
dotenv.config();

import handleApiRequest from "./handleApiRequest";
import { getSession, saveSession } from "../functions/session";
import { Server as SocketIOServer } from 'socket.io';
import handleSyncRequest from "./handleSyncRequest";
import allowedOrigin from '../auth/checkOrigin';
import { initAcitivityBroadcaster, socketConnected, socketDisconnecting, socketLeaveRoom } from './utils/activityBroadcaster';
import config, { SessionLayout } from '../../config';
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

export type apiMessage = {
  name: string;
  data: object;
  responseIndex: number;
}

export type syncMessage = {
  name: string;
  data: object;
  cb: string;
  receiver: string;
  responseIndex?: number;
  ignoreSelf?: boolean;
}

export let ioInstance: SocketIOServer | null = null;

export default function loadSocket(httpServer: any) {

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

    socket.on('apiRequest', async (msg: apiMessage) => {
      handleApiRequest({ msg, socket, token });
    });
    socket.on('sync', async (msg: syncMessage) => {
      handleSyncRequest({ msg, socket, token });
    });
    socket.on('joinRoom', async (data) => {
      const { group, responseIndex } = data;
      if (!token) {
        socket.emit(`joinRoom-${responseIndex}`, { error: 'Not authenticated' });
        return;
      }
      await withSessionLock(token, async () => {
        const session = await getSession(token);
        if (!session) {
          socket.emit(`joinRoom-${responseIndex}`, { error: 'Session not found' });
          return;
        }
        await socket.join(group);
        await saveSession(token, { ...session, code: group });
        socket.emit(`joinRoom-${responseIndex}`);
        console.log(`Socket ${socket.id} joined group ${group}`, 'cyan');
      });
    });

    socket.on('disconnect', async (reason) => {
      if (config.socketActivityBroadcaster && token) {
        socketDisconnecting({ token, socket, reason });
      } else {
        if (!token) { return; }
        console.log(`user disconnected, reason: ${reason}`, 'yellow');
      }
    });

    socket.on('updateLocation', async (newLocation) => {
      if (!token) { return; }
      console.log('updating location to: ', newLocation.pathName, 'yellow')

      await withSessionLock(token, async () => {
        let returnedUser: SessionLayout | null = null;
        if (config.socketActivityBroadcaster) {
          returnedUser = await socketLeaveRoom({ token, socket, newPath: newLocation.pathName });
        }

        if (!newLocation) { return; }
        const user = returnedUser || await getSession(token);
        if (!user) { return; }

        user.location = newLocation;
        await saveSession(token, user);
      });
    });

    if (config.socketActivityBroadcaster && token) {
      initAcitivityBroadcaster({ socket, token });
    }

    if (token) {
      socket.join(token);
    }

  });
  return io;
}