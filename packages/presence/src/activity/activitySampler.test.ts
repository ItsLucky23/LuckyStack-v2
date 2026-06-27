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

import { getRoomPresence, recordActivity, getSharedLastActivity, clearActivity } from './activitySampler';
import { registerRoomNameFormatter, defaultRoomNameFormatter, redis } from '@luckystack/core';
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

//? --- presence #3/#4 regression: AFK last-activity is local-first with a Redis
//? cross-instance mirror, so a socket active on ANOTHER instance is not falsely
//? reported AFK. Before the fix activity lived in a local-only Map → multi-instance
//? / multi-tab presence was wrong. Pin the local-hit (no Redis read), the Redis
//? fallback, the both-miss undefined, and that clearActivity drops the local entry. ---
describe('getSharedLastActivity — local-first with Redis cross-instance fallback (#3/#4)', () => {
  beforeEach(() => {
    vi.mocked(redis.get).mockReset();
    vi.mocked(redis.get).mockResolvedValue(null);
  });

  it('returns the local timestamp WITHOUT reading Redis when the socket is locally active', async () => {
    recordActivity('sock-local');
    const after = Date.now();
    const ts = await getSharedLastActivity('sock-local');
    expect(typeof ts).toBe('number');
    expect(ts).toBeLessThanOrEqual(after);
    expect(redis.get).not.toHaveBeenCalled(); // local hit short-circuits
    clearActivity('sock-local');
  });

  it('falls back to the Redis mirror for a socket active on another instance', async () => {
    vi.mocked(redis.get).mockResolvedValueOnce('1700000000000');
    const ts = await getSharedLastActivity('sock-remote');
    expect(ts).toBe(1_700_000_000_000);
    expect(redis.get).toHaveBeenCalledTimes(1);
  });

  it('returns undefined when neither the local Map nor Redis has the socket', async () => {
    const ts = await getSharedLastActivity('sock-unknown');
    expect(ts).toBeUndefined();
  });

  it('clearActivity drops the local entry so a later read falls through to Redis', async () => {
    recordActivity('sock-x');
    expect(typeof (await getSharedLastActivity('sock-x'))).toBe('number');
    clearActivity('sock-x');
    expect(await getSharedLastActivity('sock-x')).toBeUndefined(); // Redis mock returns null
  });
});
