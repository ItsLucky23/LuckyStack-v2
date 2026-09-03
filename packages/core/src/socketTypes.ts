import type { Server as SocketIOServer } from 'socket.io';
import { isProductionRuntime } from './env';
import { guardLocalSocketEnumeration } from './localSocketEnumerationGuard';

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
//? Cached guarded view of `_ioInstance` (see `getIoInstance`), rebuilt when the
//? slot changes so `getIoInstance() === getIoInstance()` holds for one server.
let _guardedIoInstance: SocketIOServer | null = null;

export const setIoInstance = (io: SocketIOServer | null): void => {
  _ioInstance = io;
  _guardedIoInstance = null;
};

export interface GetIoInstanceOptions {
  /**
   * Return the raw Socket.io server even outside production. Reach for this
   * ONLY when the per-instance view is what you want (backpressure sampling, a
   * sweep cleaning up this process's own connections) — and say why in a
   * comment, because the lint rule `luckystack/no-local-socket-enumeration`
   * will still flag the access.
   */
  raw?: boolean;
}

/**
 * Read the running Socket.io server. Outside production the returned value is
 * a guarded view that THROWS on the per-instance surfaces
 * (`sockets.adapter.rooms`, `sockets.adapter.sids`, enumerating
 * `sockets.sockets`) — see `localSocketEnumerationGuard.ts` for why. Pass
 * `{ raw: true }` for the unwrapped server. In production the raw server is
 * always returned; the guard costs nothing there.
 */
export const getIoInstance = (options?: GetIoInstanceOptions): SocketIOServer | null => {
  if (_ioInstance === null) return null;
  if (options?.raw === true || isProductionRuntime()) return _ioInstance;
  _guardedIoInstance ??= guardLocalSocketEnumeration(_ioInstance);
  return _guardedIoInstance;
};
