//? Socket.io probe transport for sync routes. A project on the default
//? `transport.invocation: 'socket'` sends every sync request over the socket,
//? which runs a different server pipeline (`handleSyncRequest`) than the
//? `/sync/*` HTTP route. Probing over HTTP alone would leave that pipeline —
//? the one real users hit — without coverage.
//?
//? One socket per session identity (the probe's Cookie header, or none for an
//? anonymous probe), opened lazily and reused for the whole sweep. An
//? authenticated socket joins `receiver` once, so room-membership enforcement
//? (`sync.requireRoomMembership`) sees a member, exactly like a real client that
//? joined its room before syncing. API endpoints are delegated to HTTP — they
//? have no socket transport in the sweep.

import type { Socket } from 'socket.io-client';
import { tryCatch } from '@luckystack/core';

import { connectTestSocket, emitSyncOverSocket, joinTestRoom } from './testSocket';
import { createHttpProbeTransport } from './probeRequest';
import type { ProbeResponse, ProbeTransport, ProbeTransportRequest } from './probeRequest';

const LABEL = 'sync probe';

export interface SocketProbeTransportOptions {
  baseUrl: string;
  /** Room every sync probe targets; authenticated sockets join it first. */
  receiver: string;
  /** Session cookie name, used to read the token out of a probe's Cookie header. */
  sessionCookieName: string;
}

//? Pull `<token>` out of a `Cookie` header that carries `<cookieName>=<token>`.
const tokenFromCookieHeader = (cookieHeader: string | undefined, cookieName: string): string | null => {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [rawName, ...rest] = part.trim().split('=');
    if (rawName === cookieName && rest.length > 0) return rest.join('=');
  }
  return null;
};

const toProbeResponse = (payload: unknown): ProbeResponse => {
  if (typeof payload !== 'object' || payload === null) return { parsed: null };
  const record = payload as { status?: unknown; errorCode?: unknown };
  return {
    parsed: {
      status: typeof record.status === 'string' ? record.status : undefined,
      errorCode: typeof record.errorCode === 'string' ? record.errorCode : undefined,
    },
  };
};

export const createSocketProbeTransport = (options: SocketProbeTransportOptions): ProbeTransport => {
  const http = createHttpProbeTransport({ syncReceiver: options.receiver });
  //? Keyed by token ('' = anonymous). A failed connect is cached as `null` so
  //? an unreachable socket endpoint fails each probe fast instead of retrying.
  const sockets = new Map<string, Promise<Socket | null>>();

  const socketFor = (token: string | null): Promise<Socket | null> => {
    const key = token ?? '';
    const existing = sockets.get(key);
    if (existing) return existing;
    const opening = (async (): Promise<Socket | null> => {
      const [connectError, socket] = await tryCatch(() => connectTestSocket({
        baseUrl: options.baseUrl,
        token,
        label: LABEL,
        sessionCookieName: options.sessionCookieName,
      }));
      if (connectError || !socket) return null;
      //? Anonymous sockets cannot join (the server answers `auth.required`);
      //? their probes then exercise exactly what an anonymous client gets.
      if (token) await tryCatch(() => joinTestRoom(socket, options.receiver, { label: LABEL }));
      return socket;
    })();
    sockets.set(key, opening);
    return opening;
  };

  const send = async (request: ProbeTransportRequest): Promise<ProbeResponse | null> => {
    if (request.endpoint.kind !== 'sync') return http.send(request);
    const socket = await socketFor(tokenFromCookieHeader(request.headers?.Cookie, options.sessionCookieName));
    if (!socket) return null;
    const outcome = await emitSyncOverSocket(socket, {
      routePath: `${request.endpoint.page}/${request.endpoint.name}/${request.endpoint.version}`,
      data: request.body,
      receiver: options.receiver,
      timeoutMs: request.requestTimeoutMs,
    });
    return outcome.kind === 'response' ? toProbeResponse(outcome.payload) : null;
  };

  const close = async (): Promise<void> => {
    const opened = [...sockets.values()];
    sockets.clear();
    for (const pending of opened) {
      const socket = await pending;
      socket?.disconnect();
    }
  };

  return { name: 'socket', send, close };
};
