//? Socket.io probe transport. A project on the default
//? `transport.invocation: 'socket'` sends every API and sync request over the
//? socket, which runs different server pipelines (`handleApiRequest`,
//? `handleSyncRequest`) than the `/api/*` and `/sync/*` HTTP routes. Probing over
//? HTTP alone would leave those pipelines — the ones real users hit — without
//? coverage (ADR 0064).
//?
//? One socket per session identity (the probe's session Cookie or Bearer
//? header, or none for an anonymous probe), opened lazily and reused for the
//? whole sweep. An authenticated socket joins `receiver` once, so
//? room-membership enforcement (`sync.requireRoomMembership`) sees a member,
//? exactly like a real client that joined its room before syncing.

import type { Socket } from 'socket.io-client';
import { tryCatch } from '@luckystack/core';

import { connectTestSocket, emitApiOverSocket, emitSyncOverSocket, joinTestRoom, releaseTestSocket } from './testSocket';
import type { ProbeResponse, ProbeTransport, ProbeTransportRequest } from './probeRequest';

const LABEL = 'socket probe';

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

//? Token-mode sweeps carry the session as `Authorization: Bearer <token>`.
const tokenFromHeaders = (headers: Record<string, string> | undefined, cookieName: string): string | null => {
  const cookieToken = tokenFromCookieHeader(headers?.Cookie, cookieName);
  if (cookieToken) return cookieToken;
  const authorization = headers?.Authorization;
  return authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : null;
};

//? Socket replies carry the status the HTTP route would have answered with in
//? the envelope's `httpStatus`, so a 5xx is visible to the checks either way.
const toProbeResponse = (payload: unknown): ProbeResponse => {
  if (typeof payload !== 'object' || payload === null) return { parsed: null };
  const record = payload as { status?: unknown; errorCode?: unknown; httpStatus?: unknown };
  return {
    ...(typeof record.httpStatus === 'number' ? { httpStatus: record.httpStatus } : {}),
    parsed: {
      status: typeof record.status === 'string' ? record.status : undefined,
      errorCode: typeof record.errorCode === 'string' ? record.errorCode : undefined,
    },
  };
};

export const createSocketProbeTransport = (options: SocketProbeTransportOptions): ProbeTransport => {
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
    const socket = await socketFor(tokenFromHeaders(request.headers, options.sessionCookieName));
    if (!socket) return null;
    const routePath = `${request.endpoint.page}/${request.endpoint.name}/${request.endpoint.version}`;
    const outcome = request.endpoint.kind === 'sync'
      ? await emitSyncOverSocket(socket, {
        routePath,
        data: request.body,
        receiver: options.receiver,
        timeoutMs: request.requestTimeoutMs,
      })
      : await emitApiOverSocket(socket, { routePath, data: request.body, timeoutMs: request.requestTimeoutMs });
    return outcome.kind === 'response' ? toProbeResponse(outcome.payload) : null;
  };

  const close = async (): Promise<void> => {
    const opened = [...sockets.entries()];
    sockets.clear();
    for (const [key, pending] of opened) {
      const socket = await pending;
      if (!socket) continue;
      //? An authenticated socket runs on the caller's session — release it so
      //? presence does not log that session out when the socket closes.
      if (key) await releaseTestSocket(socket);
      else socket.disconnect();
    }
  };

  return { name: 'socket', send, close };
};
