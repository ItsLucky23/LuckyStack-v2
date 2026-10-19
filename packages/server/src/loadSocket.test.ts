import { beforeEach, describe, expect, it, vi } from 'vitest';

//? Drives the real `loadSocket` connect handler against a fake socket.io server
//? + socket, so each listener can be invoked with hostile payloads directly. A
//? listener that throws here would, in production, throw inside socket.io's
//? `process.nextTick` dispatch and kill the process.

const { readSessionMock, writeSessionMock, dispatchHookMock, resolveClientIpMock, projectConfig, ioState } = vi.hoisted(() => ({
  readSessionMock: vi.fn(),
  writeSessionMock: vi.fn(),
  dispatchHookMock: vi.fn(),
  resolveClientIpMock: vi.fn(),
  projectConfig: {
    logging: { devLogs: false, socketStartup: false },
    socket: { maxHttpBufferSize: 1_000_000, pingTimeout: 1000, pingInterval: 1000, maxRoomsPerSession: 50 },
    http: { trustProxy: true, trustedProxyHopCount: 1 },
    socketActivityBroadcaster: false,
    locationProviderEnabled: true,
  },
  ioState: { connectHandler: null as ((socket: unknown) => void) | null },
}));

vi.mock('socket.io', () => ({
  Server: class {
    on(event: string, handler: (socket: unknown) => void) {
      if (event === 'connection') ioState.connectHandler = handler;
    }
  },
}));

vi.mock('@luckystack/api', () => ({ handleApiRequest: vi.fn() }));

vi.mock('./capabilities', () => ({
  capabilities: { sync: true, presence: false },
  getPresence: vi.fn(() => Promise.resolve(null)),
  getSync: vi.fn(() => Promise.resolve(null)),
}));

vi.mock('@luckystack/core', () => ({
  abortAllForSocket: vi.fn(),
  abortApiByResponseIndex: vi.fn(),
  abortSyncByCb: vi.fn(),
  allowedOrigin: vi.fn(() => true),
  applySocketMiddlewares: vi.fn(),
  attachSocketRedisAdapter: vi.fn(),
  formatRoomName: (room: string) => `room:${room}`,
  redis: { duplicate: () => ({}) },
  setIoInstance: vi.fn(),
  socketEventNames: {
    connect: 'connection',
    disconnect: 'disconnect',
    apiRequest: 'apiRequest',
    sync: 'sync',
    syncCancel: 'syncCancel',
    apiCancel: 'apiCancel',
    joinRoom: 'joinRoom',
    leaveRoom: 'leaveRoom',
    getJoinedRooms: 'getJoinedRooms',
    updateLocation: 'updateLocation',
    activity: 'activity',
    intentionalReconnect: 'intentionalReconnect',
  },
  buildJoinRoomResponseEventName: (i: number) => `joinRoomResponse-${i}`,
  buildLeaveRoomResponseEventName: (i: number) => `leaveRoomResponse-${i}`,
  buildGetJoinedRoomsResponseEventName: (i: number) => `getJoinedRoomsResponse-${i}`,
  extractLanguageFromHeader: () => '',
  extractTokenFromSocket: (socket: { handshake: { auth: { token?: string } } }) => socket.handshake.auth.token ?? null,
  getLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  getProjectConfig: () => projectConfig,
  dispatchHook: (...args: unknown[]) => dispatchHookMock(...args) as unknown,
  normalizeErrorResponse: ({ response }: { response: { errorCode: string } }) => ({ status: 'error', errorCode: response.errorCode }),
  readSession: (token: string | null) => readSessionMock(token) as unknown,
  resolveClientIp: (params: unknown) => resolveClientIpMock(params) as unknown,
  writeSession: (...args: unknown[]) => writeSessionMock(...args) as unknown,
  tryCatch: async (fn: () => Promise<unknown>) => {
    try {
      return [null, await fn()];
    } catch (error) {
      return [error, null];
    }
  },
}));

import type { Server as HttpServer } from 'node:http';
import { loadSocket } from './loadSocket';

interface FakeSocket {
  id: string;
  rooms: Set<string>;
  handshake: { address: string; headers: Record<string, string>; auth: { token?: string } };
  listeners: Map<string, (...args: unknown[]) => void>;
  on: (event: string, fn: (...args: unknown[]) => void) => void;
  emit: ReturnType<typeof vi.fn>;
  join: ReturnType<typeof vi.fn>;
  leave: ReturnType<typeof vi.fn>;
}

const connect = (token?: string): FakeSocket => {
  const socket: FakeSocket = {
    id: 'sock-1',
    rooms: new Set(['sock-1']),
    handshake: { address: '127.0.0.1', headers: { 'x-forwarded-for': '203.0.113.7' }, auth: token ? { token } : {} },
    listeners: new Map(),
    on(event, fn) { this.listeners.set(event, fn); },
    emit: vi.fn(),
    join: vi.fn(async (room: string) => { socket.rooms.add(room); }),
    leave: vi.fn(async (room: string) => { socket.rooms.delete(room); }),
  };
  loadSocket({} as HttpServer);
  if (!ioState.connectHandler) throw new Error('connect handler not registered');
  ioState.connectHandler(socket);
  return socket;
};

const listener = (socket: FakeSocket, event: string): ((...args: unknown[]) => void) => {
  const fn = socket.listeners.get(event);
  if (!fn) throw new Error(`no listener for ${event}`);
  return fn;
};

beforeEach(() => {
  vi.clearAllMocks();
  ioState.connectHandler = null;
  dispatchHookMock.mockResolvedValue({ stopped: false });
  readSessionMock.mockResolvedValue({ id: 'u1', roomCodes: [] });
  writeSessionMock.mockResolvedValue({ ok: true });
  resolveClientIpMock.mockReturnValue('203.0.113.7');
});

describe('loadSocket — payload-less events must not throw (finding 001)', () => {
  const events = ['joinRoom', 'leaveRoom', 'getJoinedRooms', 'syncCancel', 'apiCancel', 'updateLocation'];
  const hostilePayloads: [string, unknown[]][] = [
    ['no payload', []],
    ['null', [null]],
    ['a number', [42]],
    ['a string', ['x']],
  ];

  for (const event of events) {
    for (const [label, args] of hostilePayloads) {
      it(`${event} with ${label} (anonymous socket)`, () => {
        const socket = connect();
        expect(() => { listener(socket, event)(...args); }).not.toThrow();
      });
      it(`${event} with ${label} (authenticated socket)`, () => {
        const socket = connect('tok');
        expect(() => { listener(socket, event)(...args); }).not.toThrow();
      });
    }
  }

  it('updateLocation with searchParams: null does not throw', () => {
    const socket = connect('tok');
    expect(() => { listener(socket, 'updateLocation')({ pathName: '/a', searchParams: null }); }).not.toThrow();
    expect(writeSessionMock).not.toHaveBeenCalled();
  });
});

describe('loadSocket — room/location writes never resurrect a deleted session (finding 009)', () => {
  it('joinRoom writes with onlyIfExists and succeeds normally while the session exists', async () => {
    const socket = connect('tok');
    listener(socket, 'joinRoom')({ group: 'lobby', responseIndex: 1 });
    await vi.waitFor(() => { expect(socket.emit).toHaveBeenCalled(); });

    expect(writeSessionMock).toHaveBeenCalledWith('tok', expect.objectContaining({ roomCodes: ['lobby'] }), undefined, { onlyIfExists: true });
    expect(socket.emit).toHaveBeenCalledWith('joinRoomResponse-1', { rooms: ['room:lobby'] });
    expect(dispatchHookMock).toHaveBeenCalledWith('postRoomJoin', expect.anything());
  });

  it('joinRoom aborts, leaves the room and reports session.notFound when the session was deleted mid-flight', async () => {
    writeSessionMock.mockResolvedValue({ ok: false, errorCode: 'session.notFound' });
    const socket = connect('tok');
    listener(socket, 'joinRoom')({ group: 'lobby', responseIndex: 2 });
    await vi.waitFor(() => { expect(socket.emit).toHaveBeenCalled(); });

    expect(socket.emit).toHaveBeenCalledWith('joinRoomResponse-2', { status: 'error', errorCode: 'session.notFound' });
    expect(socket.leave).toHaveBeenCalledWith('room:lobby');
    expect(socket.rooms.has('room:lobby')).toBe(false);
    expect(dispatchHookMock).not.toHaveBeenCalledWith('postRoomJoin', expect.anything());
  });

  it('leaveRoom writes with onlyIfExists and reports the failure', async () => {
    readSessionMock.mockResolvedValue({ id: 'u1', roomCodes: ['lobby'] });
    writeSessionMock.mockResolvedValue({ ok: false, errorCode: 'session.notFound' });
    const socket = connect('tok');
    listener(socket, 'leaveRoom')({ group: 'lobby', responseIndex: 3 });
    await vi.waitFor(() => { expect(socket.emit).toHaveBeenCalled(); });

    expect(writeSessionMock).toHaveBeenCalledWith('tok', expect.objectContaining({ roomCodes: [] }), undefined, { onlyIfExists: true });
    expect(socket.emit).toHaveBeenCalledWith('leaveRoomResponse-3', { status: 'error', errorCode: 'session.notFound' });
    expect(dispatchHookMock).not.toHaveBeenCalledWith('postRoomLeave', expect.anything());
  });

  it('updateLocation writes with onlyIfExists and skips onLocationUpdate when the session is gone', async () => {
    writeSessionMock.mockResolvedValue({ ok: false, errorCode: 'session.notFound' });
    const socket = connect('tok');
    listener(socket, 'updateLocation')({ pathName: '/home', searchParams: { a: 'b' } });
    await vi.waitFor(() => { expect(writeSessionMock).toHaveBeenCalled(); });
    await new Promise((resolve) => { setTimeout(resolve, 0); });

    expect(writeSessionMock).toHaveBeenCalledWith(
      'tok',
      expect.objectContaining({ location: { pathName: '/home', searchParams: { a: 'b' } } }),
      undefined,
      { onlyIfExists: true },
    );
    expect(dispatchHookMock).not.toHaveBeenCalledWith('onLocationUpdate', expect.anything());
  });

  it('updateLocation dispatches onLocationUpdate after a successful write', async () => {
    const socket = connect('tok');
    listener(socket, 'updateLocation')({ pathName: '/home' });
    await vi.waitFor(() => {
      expect(dispatchHookMock).toHaveBeenCalledWith('onLocationUpdate', expect.objectContaining({ newLocation: { pathName: '/home' } }));
    });
  });
});

describe('loadSocket — the sync every-socket sentinel is not a room (finding 016)', () => {
  it('joinRoom("all") answers room.invalid and never joins', async () => {
    const socket = connect('tok');
    listener(socket, 'joinRoom')({ group: ' all ', responseIndex: 4 });
    await new Promise((resolve) => { setTimeout(resolve, 0); });

    expect(socket.emit).toHaveBeenCalledWith('joinRoomResponse-4', { status: 'error', errorCode: 'room.invalid' });
    expect(socket.join).not.toHaveBeenCalledWith('room:all');
    expect(writeSessionMock).not.toHaveBeenCalled();
  });

  it('skips a persisted "all" room code when rejoining on connect', async () => {
    readSessionMock.mockResolvedValue({ id: 'u1', roomCodes: ['all', 'lobby'] });
    const socket = connect('tok');
    await vi.waitFor(() => { expect(socket.join).toHaveBeenCalledWith('room:lobby'); });

    expect(socket.join).not.toHaveBeenCalledWith('room:all');
  });
});

describe('loadSocket — onSocketConnect ip (finding 088)', () => {
  it('resolves the client IP through http.trustProxy instead of the raw socket address', () => {
    connect('tok');
    expect(resolveClientIpMock).toHaveBeenCalledWith({
      rawAddress: '127.0.0.1',
      headers: { 'x-forwarded-for': '203.0.113.7' },
      trustProxy: true,
      trustedProxyHopCount: 1,
    });
    expect(dispatchHookMock).toHaveBeenCalledWith('onSocketConnect', { socketId: 'sock-1', token: 'tok', ip: '203.0.113.7' });
  });
});
