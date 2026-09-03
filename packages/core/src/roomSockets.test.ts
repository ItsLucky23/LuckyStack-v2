import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const state = vi.hoisted(() => ({
  io: null as null | {
    fetchSockets: ReturnType<typeof vi.fn>;
    in: ReturnType<typeof vi.fn>;
  },
  rawCalls: [] as (boolean | undefined)[],
}));

vi.mock('./socketTypes', () => ({
  getIoInstance: vi.fn((options?: { raw?: boolean }) => {
    state.rawCalls.push(options?.raw);
    return state.io;
  }),
}));

import { getRoomSockets } from './roomSockets';
import { registerRoomNameFormatter, defaultRoomNameFormatter, type RoomNameFormatterContext } from './roomNameFormatterRegistry';

const makeIo = () => {
  const roomFetch = vi.fn(() => Promise.resolve([{ id: 'r1' }]));
  const io = {
    fetchSockets: vi.fn(() => Promise.resolve([{ id: 'a' }, { id: 'b' }])),
    in: vi.fn(() => ({ fetchSockets: roomFetch })),
  };
  return { io, roomFetch };
};

describe('getRoomSockets', () => {
  beforeEach(() => {
    state.rawCalls.length = 0;
    state.io = null;
  });
  afterEach(() => {
    registerRoomNameFormatter(defaultRoomNameFormatter);
  });

  it('throws instead of returning [] when no Socket.io server is registered', async () => {
    await expect(getRoomSockets('room-1')).rejects.toThrow(/setIoInstance/);
  });

  it('rejects an empty room code', async () => {
    state.io = makeIo().io;
    await expect(getRoomSockets('   ')).rejects.toThrow(/non-empty/);
  });

  it('resolves a room cross-instance via io.in(room).fetchSockets() on the RAW server', async () => {
    const { io, roomFetch } = makeIo();
    state.io = io;
    await expect(getRoomSockets(' room-1 ')).resolves.toEqual([{ id: 'r1' }]);
    expect(io.in).toHaveBeenCalledWith('room-1');
    expect(roomFetch).toHaveBeenCalledTimes(1);
    expect(io.fetchSockets).not.toHaveBeenCalled();
    //? The helper must bypass the dev guard — it is the sanctioned path.
    expect(state.rawCalls).toEqual([true]);
  });

  it("resolves 'all' via io.fetchSockets() without touching the formatter", async () => {
    const { io } = makeIo();
    state.io = io;
    const formatter = vi.fn((raw: string) => `tenant:${raw}`);
    registerRoomNameFormatter(formatter);
    await expect(getRoomSockets('all')).resolves.toHaveLength(2);
    expect(io.in).not.toHaveBeenCalled();
    expect(formatter).not.toHaveBeenCalled();
  });

  it("routes the logical room through the formatter under 'broadcast' with userId null by default", async () => {
    const { io } = makeIo();
    state.io = io;
    const seen: RoomNameFormatterContext[] = [];
    registerRoomNameFormatter((raw, ctx) => {
      seen.push(ctx);
      return `tenant:${raw}`;
    });
    await getRoomSockets('room-1');
    await getRoomSockets('room-1', { userId: 'u-42' });
    expect(io.in).toHaveBeenNthCalledWith(1, 'tenant:room-1');
    expect(io.in).toHaveBeenNthCalledWith(2, 'tenant:room-1');
    expect(seen).toEqual([
      { purpose: 'broadcast', userId: null },
      { purpose: 'broadcast', userId: 'u-42' },
    ]);
  });
});
