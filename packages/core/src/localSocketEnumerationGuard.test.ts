import { describe, it, expect, vi, afterEach } from 'vitest';
import { guardLocalSocketEnumeration, LocalSocketEnumerationError, type GuardableSocketServer } from './localSocketEnumerationGuard';
import { getIoInstance, setIoInstance } from './socketTypes';

//? Structural double: only the members the guard routes through, plus a couple
//? of cross-instance methods that must keep working through the proxy.
interface FakeSocket { id: string; emit: ReturnType<typeof vi.fn> }

const makeFakeServer = () => {
  const socketA: FakeSocket = { id: 'a', emit: vi.fn() };
  const socketB: FakeSocket = { id: 'b', emit: vi.fn() };
  const socketsMap = new Map<string, unknown>([
    ['a', socketA],
    ['b', socketB],
  ]);
  const adapter = {
    rooms: new Map<string, Set<string>>([['room-1', new Set(['a'])]]),
    sids: new Map<string, Set<string>>([['a', new Set(['room-1'])]]),
    //? A method reading private-ish state through `this`, to prove binding.
    roomCount(this: { rooms: Map<string, Set<string>> }) {
      return this.rooms.size;
    },
  };
  const fetchSockets = vi.fn(() => Promise.resolve([socketA, socketB]));
  const server = {
    sockets: { adapter, sockets: socketsMap },
    fetchSockets,
    in: vi.fn((_room: string) => ({ fetchSockets })),
    to: vi.fn((_room: string) => ({ emit: vi.fn() })),
  };
  return { server, socketA, adapter, fetchSockets };
};

describe('guardLocalSocketEnumeration', () => {
  it('throws on the per-instance adapter maps', () => {
    const { server } = makeFakeServer();
    const io = guardLocalSocketEnumeration(server);
    expect(() => io.sockets.adapter.rooms).toThrow(LocalSocketEnumerationError);
    expect(() => io.sockets.adapter.sids).toThrow(LocalSocketEnumerationError);
    expect(() => io.sockets.adapter.rooms).toThrow(/getRoomSockets|fetchSockets/);
  });

  it('throws on enumerating the local sockets map, in every enumeration form', () => {
    const { server } = makeFakeServer();
    const io = guardLocalSocketEnumeration(server);
    expect(() => io.sockets.sockets.values()).toThrow(LocalSocketEnumerationError);
    expect(() => io.sockets.sockets.keys()).toThrow(LocalSocketEnumerationError);
    expect(() => io.sockets.sockets.entries()).toThrow(LocalSocketEnumerationError);
    expect(() => io.sockets.sockets.forEach(() => undefined)).toThrow(LocalSocketEnumerationError);
    expect(() => io.sockets.sockets.size).toThrow(LocalSocketEnumerationError);
    expect(() => [...io.sockets.sockets]).toThrow(LocalSocketEnumerationError);
    //? Computed access is exactly what the lint rule cannot see.
    const key = 'sockets';
    expect(() => io[key][key].size).toThrow(LocalSocketEnumerationError);
  });

  it('keeps the local lookup `sockets.sockets.get(id)` and the cross-instance methods working', async () => {
    const { server, socketA, adapter, fetchSockets } = makeFakeServer();
    const io = guardLocalSocketEnumeration(server);
    expect(io.sockets.sockets.get('a')).toBe(socketA);
    expect(io.sockets.sockets.has('zzz')).toBe(false);
    await expect(io.in('room-1').fetchSockets()).resolves.toHaveLength(2);
    await expect(io.fetchSockets()).resolves.toHaveLength(2);
    expect(fetchSockets).toHaveBeenCalledTimes(2);
    io.to('room-1');
    expect(server.to).toHaveBeenCalledWith('room-1');
    //? Methods must run against the REAL adapter, not the proxy.
    expect(io.sockets.adapter.roomCount()).toBe(adapter.rooms.size);
  });
});

describe('getIoInstance guard mode', () => {
  afterEach(() => {
    setIoInstance(null);
    vi.unstubAllEnvs();
  });

  //? `setIoInstance` is typed on the real Socket.io `Server`; the double covers
  //? only the members the guard touches. One boundary assertion is the
  //? documented test seam (see handleSyncTransport.test.ts in @luckystack/sync).
  const install = (server: GuardableSocketServer): void => {
    // eslint-disable-next-line no-restricted-syntax, @typescript-eslint/consistent-type-assertions -- socket.io Server test double boundary; the double covers only the members the guard routes through
    setIoInstance(server as unknown as Parameters<typeof setIoInstance>[0]);
  };

  it('returns a guarded view outside production, the raw server with { raw: true }, and a stable identity', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const { server } = makeFakeServer();
    install(server);
    const guarded = getIoInstance();
    expect(guarded).not.toBeNull();
    expect(guarded).not.toBe(server);
    expect(getIoInstance()).toBe(guarded);
    expect(() => guarded?.sockets.adapter.rooms).toThrow(LocalSocketEnumerationError);
    expect(getIoInstance({ raw: true })).toBe(server);
  });

  it('returns the raw server in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { server } = makeFakeServer();
    install(server);
    expect(getIoInstance()).toBe(server);
  });

  it('drops the cached guard when the slot changes', () => {
    vi.stubEnv('NODE_ENV', 'test');
    const first = makeFakeServer();
    install(first.server);
    const guardedFirst = getIoInstance();
    const second = makeFakeServer();
    install(second.server);
    expect(getIoInstance()).not.toBe(guardedFirst);
    expect(getIoInstance({ raw: true })).toBe(second.server);
    setIoInstance(null);
    expect(getIoInstance()).toBeNull();
  });
});
