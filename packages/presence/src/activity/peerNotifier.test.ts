import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

//? peerNotifier fans presence events out to a room's peers. We exercise the
//? room-name formatter seam (M2/D4) and the userLeft broadcast (MIS-003) with
//? the REAL core formatter registry (so the seam is genuinely wired) while
//? mocking the session/socket DI seams:
//?  - readSession          -> session lookup (userAfk/userBack path)
//?  - dispatchHook         -> pre/postPresenceUpdate (no veto by default)
//?  - extractTokenFromSocket -> per-peer token (ignoreSelf / departing-self skip)
//?  - getIoInstance        -> io stub whose `in(room).fetchSockets()` we assert

const readSessionMock = vi.fn();
const dispatchHookMock = vi.fn();
const extractTokenFromSocketMock = vi.fn();

//? Records the physical room name handed to `io.in(...)` so a test can assert
//? the formatter prefix was applied.
let lastInRoom: string | undefined;
let fetchSocketsResult: Array<{ id: string; emit: ReturnType<typeof vi.fn> }> = [];
//? When set, maps a physical room name -> its socket list, so a test can return
//? DIFFERENT peers per room (to exercise the cross-room dedup in the shared
//? `forEachRoomPeer` helper). Falls back to `fetchSocketsResult` when unset.
let fetchSocketsByRoom: Record<string, Array<{ id: string; emit: ReturnType<typeof vi.fn> }>> | undefined;

const ioStub = {
  in: (room: string) => {
    lastInRoom = room;
    return {
      fetchSockets: () =>
        Promise.resolve(fetchSocketsByRoom ? (fetchSocketsByRoom[room] ?? []) : fetchSocketsResult),
    };
  },
};

vi.mock('@luckystack/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@luckystack/core')>()),
  readSession: (token: string) => readSessionMock(token),
  dispatchHook: (...args: unknown[]) => dispatchHookMock(...args),
  extractTokenFromSocket: (socket: unknown) => extractTokenFromSocketMock(socket),
  getIoInstance: () => ioStub,
  getLogger: () => ({ debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

import { informRoomPeers, informRoomPeersLeft } from './peerNotifier';
import {
  registerRoomNameFormatter,
  defaultRoomNameFormatter,
  socketEventNames,
} from '@luckystack/core';
import type { RoomNameFormatter } from '@luckystack/core';

const makePeer = (id: string) => ({ id, emit: vi.fn() });

describe('peerNotifier room-name formatter + userLeft', () => {
  beforeEach(() => {
    readSessionMock.mockReset();
    dispatchHookMock.mockReset();
    extractTokenFromSocketMock.mockReset();
    dispatchHookMock.mockResolvedValue({ stopped: false });
    lastInRoom = undefined;
    fetchSocketsResult = [];
    fetchSocketsByRoom = undefined;
    registerRoomNameFormatter(defaultRoomNameFormatter);
  });

  afterEach(() => {
    registerRoomNameFormatter(defaultRoomNameFormatter);
  });

  describe('informRoomPeers (userAfk/userBack)', () => {
    it('routes the room name through the registered formatter (M2/D4)', async () => {
      const formatter: RoomNameFormatter = (raw, ctx) => `tenant-A:${ctx.purpose}:${raw}`;
      registerRoomNameFormatter(formatter);
      readSessionMock.mockResolvedValue({ id: 'u1', roomCodes: ['room-1'] });
      const peer = makePeer('s2');
      fetchSocketsResult = [peer];
      extractTokenFromSocketMock.mockReturnValue('other');

      await informRoomPeers({ token: 'tok', io: ioStub as never, event: socketEventNames.userBack });

      expect(lastInRoom).toBe('tenant-A:presence:room-1');
      expect(peer.emit).toHaveBeenCalledWith('userBack', { userId: 'u1' });
    });

    it('emits to a peer present in multiple rooms only once (cross-room dedup)', async () => {
      readSessionMock.mockResolvedValue({ id: 'u1', roomCodes: ['room-1', 'room-2'] });
      extractTokenFromSocketMock.mockReturnValue('other');
      //? Same socket id 'shared' appears in both rooms; a fresh peer 'only-2' in
      //? room-2. The shared `handledSockets` Set must collapse 'shared' to one emit.
      const sharedInRoom1 = makePeer('shared');
      const sharedInRoom2 = makePeer('shared');
      const only2 = makePeer('only-2');
      fetchSocketsByRoom = {
        'room-1': [sharedInRoom1],
        'room-2': [sharedInRoom2, only2],
      };

      await informRoomPeers({ token: 'tok', io: ioStub as never, event: socketEventNames.userBack });

      expect(sharedInRoom1.emit).toHaveBeenCalledTimes(1);
      expect(sharedInRoom2.emit).not.toHaveBeenCalled();
      expect(only2.emit).toHaveBeenCalledTimes(1);
      //? recipientCount reaches postPresenceUpdate: 2 distinct peers (shared + only-2).
      expect(dispatchHookMock).toHaveBeenLastCalledWith(
        'postPresenceUpdate',
        expect.objectContaining({ recipientCount: 2 }),
      );
    });
  });

  describe('informRoomPeersLeft (MIS-003)', () => {
    it('emits userLeft with userId to room peers and returns the recipient count', async () => {
      const peer = makePeer('s2');
      fetchSocketsResult = [peer];
      extractTokenFromSocketMock.mockReturnValue('other');

      const count = await informRoomPeersLeft({
        token: 'tok',
        userId: 'u1',
        roomCodes: ['room-1'],
        io: ioStub as never,
      });

      expect(peer.emit).toHaveBeenCalledWith('userLeft', { userId: 'u1' });
      expect(count).toBe(1);
    });

    it('routes the room name through the registered formatter (M2/D4)', async () => {
      const formatter: RoomNameFormatter = (raw) => `tenant-A:${raw}`;
      registerRoomNameFormatter(formatter);
      fetchSocketsResult = [makePeer('s2')];
      extractTokenFromSocketMock.mockReturnValue('other');

      await informRoomPeersLeft({ token: 'tok', userId: 'u1', roomCodes: ['room-1'], io: ioStub as never });

      expect(lastInRoom).toBe('tenant-A:room-1');
    });

    it('does not notify the departing user own lingering sockets', async () => {
      const ownTab = makePeer('s-own');
      const peer = makePeer('s2');
      fetchSocketsResult = [ownTab, peer];
      //? s-own resolves to the departing token; s2 is a different user.
      extractTokenFromSocketMock.mockImplementation((s: { id: string }) =>
        s.id === 's-own' ? 'tok' : 'other',
      );

      const count = await informRoomPeersLeft({
        token: 'tok',
        userId: 'u1',
        roomCodes: ['room-1'],
        io: ioStub as never,
      });

      expect(ownTab.emit).not.toHaveBeenCalled();
      expect(peer.emit).toHaveBeenCalledWith('userLeft', { userId: 'u1' });
      expect(count).toBe(1);
    });

    it('emits userLeft to a peer present in multiple rooms only once (cross-room dedup)', async () => {
      extractTokenFromSocketMock.mockReturnValue('other');
      const sharedInRoom1 = makePeer('shared');
      const sharedInRoom2 = makePeer('shared');
      const only2 = makePeer('only-2');
      fetchSocketsByRoom = {
        'room-1': [sharedInRoom1],
        'room-2': [sharedInRoom2, only2],
      };

      const count = await informRoomPeersLeft({
        token: 'tok',
        userId: 'u1',
        roomCodes: ['room-1', 'room-2'],
        io: ioStub as never,
      });

      expect(sharedInRoom1.emit).toHaveBeenCalledTimes(1);
      expect(sharedInRoom2.emit).not.toHaveBeenCalled();
      expect(only2.emit).toHaveBeenCalledTimes(1);
      expect(count).toBe(2);
    });

    it('is a no-op with no rooms', async () => {
      const count = await informRoomPeersLeft({
        token: 'tok',
        userId: 'u1',
        roomCodes: [],
        io: ioStub as never,
      });
      expect(count).toBe(0);
    });
  });
});
