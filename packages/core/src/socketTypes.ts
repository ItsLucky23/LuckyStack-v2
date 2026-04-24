import type { Server as SocketIOServer } from 'socket.io';

//? Shared wire-protocol types for the socket-based API and sync transports.
//? These used to live in `server/sockets/socket.ts` — moved to core so
//? framework packages (@luckystack/api, @luckystack/sync) can stop
//? deep-relative-importing into the project's server directory.

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

//? Module-level slot for the running Socket.io server instance. The project
//? calls `setIoInstance(io)` right after constructing the server; framework
//? packages call `getIoInstance()` when they need to broadcast.
let _ioInstance: SocketIOServer | null = null;

export const setIoInstance = (io: SocketIOServer | null): void => {
  _ioInstance = io;
};

export const getIoInstance = (): SocketIOServer | null => _ioInstance;
