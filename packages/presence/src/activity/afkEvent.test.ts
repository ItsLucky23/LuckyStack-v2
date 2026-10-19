import { describe, it, expect, vi, beforeEach } from 'vitest';

//? The built-in AFK event (030): it must look up the user's OTHER sockets via
//? the token room (not a cluster-wide `io.fetchSockets()`), and announce one
//? `userAfk` per idle episode instead of once per refractory window while the
//? user stays idle. DI seams mocked:
//?  - getIoInstance          -> io stub recording `in(room)` + a whole-server spy
//?  - extractTokenFromSocket -> per-socket token
//?  - ./peerNotifier         -> informRoomPeers (the fan-out we count)
//?  - ./activitySampler      -> getSharedLastActivity (other tabs' activity)

const informRoomPeersMock = vi.fn();
const getSharedLastActivityMock = vi.fn();
const serverWideFetchSockets = vi.fn(async () => []);
const inRooms: string[] = [];
let tokenRoomSockets: Array<{ id: string; token: string }> = [];

const ioStub = {
  fetchSockets: serverWideFetchSockets,
  in: (room: string) => {
    inRooms.push(room);
    return { fetchSockets: async () => tokenRoomSockets };
  },
};

vi.mock('@luckystack/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@luckystack/core')>()),
  getIoInstance: () => ioStub,
  extractTokenFromSocket: (socket: { token: string }) => socket.token,
  getLogger: () => ({ debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

vi.mock('./peerNotifier', () => ({
  informRoomPeers: (...args: unknown[]) => informRoomPeersMock(...args),
}));

vi.mock('./activitySampler', () => ({
  getSharedLastActivity: (socketId: string) => getSharedLastActivityMock(socketId),
}));

import { registerDefaultAfkEvent } from './afkEvent';
import { dispatchActivitySample, clearActivityThrottle } from '../activityEvents';
import { registerPresenceConfig } from '../presenceConfig';
import { lastAfkFireByToken } from './state';

const AFK_MS = 5 * 60_000;
const T0 = 10_000_000;

const sample = (socketId: string, lastActivity: number, now: number) =>
  dispatchActivitySample({ socketId, token: 'tok', lastActivity, now });

describe('default AFK event (030)', () => {
  beforeEach(() => {
    registerPresenceConfig({ afkTimeoutMs: AFK_MS });
    registerDefaultAfkEvent();
    informRoomPeersMock.mockReset();
    informRoomPeersMock.mockResolvedValue(undefined);
    getSharedLastActivityMock.mockReset();
    serverWideFetchSockets.mockClear();
    inRooms.length = 0;
    tokenRoomSockets = [];
    lastAfkFireByToken.clear();
    clearActivityThrottle('s1');
    clearActivityThrottle('s2');
  });

  it('looks up the user sockets through the token room, never the whole cluster', async () => {
    tokenRoomSockets = [{ id: 's1', token: 'tok' }];
    await sample('s1', T0, T0 + AFK_MS + 1);

    expect(inRooms).toEqual(['tok']);
    expect(serverWideFetchSockets).not.toHaveBeenCalled();
    expect(informRoomPeersMock).toHaveBeenCalledTimes(1);
  });

  it('announces one userAfk per idle episode while the user stays idle', async () => {
    tokenRoomSockets = [{ id: 's1', token: 'tok' }];
    const firstFire = T0 + AFK_MS + 1;
    await sample('s1', T0, firstFire);
    //? Ten more refractory windows of the same idle period.
    for (let minute = 1; minute <= 10; minute++) {
      await sample('s1', T0, firstFire + minute * 61_000);
    }

    expect(informRoomPeersMock).toHaveBeenCalledTimes(1);
    //? The repeats skip the adapter lookup entirely.
    expect(inRooms).toHaveLength(1);
  });

  it('re-arms after new activity starts a new idle episode', async () => {
    tokenRoomSockets = [{ id: 's1', token: 'tok' }];
    const firstFire = T0 + AFK_MS + 1;
    await sample('s1', T0, firstFire);

    const backAt = firstFire + 1000;
    await sample('s1', backAt, backAt + AFK_MS + 1);

    expect(informRoomPeersMock).toHaveBeenCalledTimes(2);
  });

  it('announces a multi-tab user once when both idle tabs pass the trigger (PRESENCE-4)', async () => {
    tokenRoomSockets = [{ id: 's1', token: 'tok' }, { id: 's2', token: 'tok' }];
    getSharedLastActivityMock.mockResolvedValue(T0);
    const now = T0 + AFK_MS + 1;
    await Promise.all([sample('s1', T0, now), sample('s2', T0, now)]);

    expect(informRoomPeersMock).toHaveBeenCalledTimes(1);
  });

  it('stays silent while another tab of the user is active (PRESENCE-5)', async () => {
    tokenRoomSockets = [{ id: 's1', token: 'tok' }, { id: 's2', token: 'tok' }];
    const now = T0 + AFK_MS + 1;
    getSharedLastActivityMock.mockResolvedValue(now - 1000);
    await sample('s1', T0, now);

    expect(informRoomPeersMock).not.toHaveBeenCalled();
  });
});
