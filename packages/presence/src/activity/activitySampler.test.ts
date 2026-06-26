import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

//? `getRoomPresence` snapshots a room's peers for a late joiner. It MUST resolve
//? the same physical room the broadcast side (`informRoomPeers`/`informRoomPeersLeft`)
//? targets, i.e. route the raw room code through the core room-name formatter
//? (M2/D4). We exercise the seam with the REAL core formatter registry while
//? mocking the io / token DI seams:
//?  - getIoInstance         -> io stub whose `in(room).fetchSockets()` we record
//?  - extractTokenFromSocket -> per-peer token in the snapshot entry

const extractTokenFromSocketMock = vi.fn();

//? Records the physical room name handed to `io.in(...)` so a test can assert
//? the formatter prefix was applied.
let lastInRoom: string | undefined;
let fetchSocketsResult: { id: string }[] = [];

const ioStub = {
  in: (room: string): { fetchSockets: () => Promise<{ id: string }[]> } => {
    lastInRoom = room;
    return { fetchSockets: (): Promise<{ id: string }[]> => Promise.resolve(fetchSocketsResult) };
  },
  //? Required so `getRoomPresence` can check whether each fetched socket is
  //? local (in the local Map) or remote (on another instance). Tests use an
  //? empty Map so all fetched sockets are treated as remote → afk: 'unknown'.
  sockets: { sockets: new Map<string, unknown>() },
};

vi.mock('@luckystack/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@luckystack/core')>()),
  extractTokenFromSocket: (socket: unknown) => extractTokenFromSocketMock(socket),
  getIoInstance: () => ioStub,
  getLogger: () => ({ debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() }),
  //? `getRoomPresence` now resolves each peer's userId via readSession and reads
  //? the cross-instance activity mirror via the `redis` proxy — stub both so the
  //? snapshot resolves without touching a real session store / Redis connection.
  readSession: vi.fn(async () => null),
  redis: { get: vi.fn(async () => null), set: vi.fn(async () => 'OK'), del: vi.fn(async () => 1) },
}));

import { getRoomPresence } from './activitySampler';
import { registerRoomNameFormatter, defaultRoomNameFormatter } from '@luckystack/core';
import type { RoomNameFormatter } from '@luckystack/core';

const prefixFormatter: RoomNameFormatter = (raw, ctx) => `tenant-A:${ctx.purpose}:${raw}`;

describe('getRoomPresence room-name formatter', () => {
  beforeEach(() => {
    extractTokenFromSocketMock.mockReset();
    extractTokenFromSocketMock.mockReturnValue(null);
    lastInRoom = undefined;
    fetchSocketsResult = [];
    registerRoomNameFormatter(defaultRoomNameFormatter);
  });

  afterEach(() => {
    registerRoomNameFormatter(defaultRoomNameFormatter);
  });

  it('queries the raw room code under the default identity formatter', async () => {
    fetchSocketsResult = [{ id: 's1' }];

    await getRoomPresence('room-1', { io: ioStub as never });

    expect(lastInRoom).toBe('room-1');
  });

  it('routes the room name through the registered formatter (M2/D4)', async () => {
    registerRoomNameFormatter(prefixFormatter);
    fetchSocketsResult = [{ id: 's1' }];

    await getRoomPresence('room-1', { io: ioStub as never });

    expect(lastInRoom).toBe('tenant-A:presence:room-1');
  });
});
