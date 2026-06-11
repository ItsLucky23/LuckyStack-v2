import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { Server, Socket } from 'socket.io';

//? lifecycle.ts wires the disconnect grace window. We exercise the pure
//? state-machine (timer set/clear, tempDisconnectedSockets, clientSwitchedTab)
//? by mocking every DI seam it imports:
//?  - @luckystack/login -> getSession / deleteSession
//?  - @luckystack/core   -> dispatchHook / getLogger / socketEventNames
//?  - ./peerNotifier     -> informRoomPeers (no real io fan-out)
//?  - ./leaveRoom        -> socketLeaveRoom (no real session lookup)
//? The shared mutable Sets/Map live in ./state; we import and clear them per
//? test so each scenario starts from an empty registry.

const getSessionMock = vi.fn();
const deleteSessionMock = vi.fn();

vi.mock('@luckystack/login', () => ({
  getSession: (token: string) => getSessionMock(token),
  deleteSession: (token: string) => deleteSessionMock(token),
}));

const dispatchHookMock = vi.fn();
const informRoomPeersMock = vi.fn();
const socketLeaveRoomMock = vi.fn();

vi.mock('@luckystack/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@luckystack/core')>()),
  dispatchHook: (...args: unknown[]) => dispatchHookMock(...args),
  //? 0.2.0: session reads/deletes moved to core's null-safe accessors.
  readSession: (token: string) => getSessionMock(token),
  removeSession: (token: string) => deleteSessionMock(token),
  getLogger: () => ({
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
  socketEventNames: {
    userAfk: 'userAfk',
    userBack: 'userBack',
    intentionalDisconnect: 'intentionalDisconnect',
  },
}));

vi.mock('./peerNotifier', () => ({
  informRoomPeers: (...args: unknown[]) => informRoomPeersMock(...args),
}));

vi.mock('./leaveRoom', () => ({
  socketLeaveRoom: (...args: unknown[]) => socketLeaveRoomMock(...args),
}));

import { socketConnected, socketDisconnecting, initActivityBroadcaster } from './lifecycle';
import { clientSwitchedTab, disconnectTimers, tempDisconnectedSockets } from './state';
import { registerPresenceConfig } from '../presenceConfig';

//? A throwaway io stub — lifecycle.ts only forwards it to informRoomPeers,
//? which is mocked, so its shape is never inspected here.
const ioStub = {} as Server;

const resetState = (): void => {
  for (const timer of disconnectTimers.values()) clearTimeout(timer);
  disconnectTimers.clear();
  tempDisconnectedSockets.clear();
  clientSwitchedTab.clear();
};

describe('lifecycle (presence grace timers)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetState();
    registerPresenceConfig({});
    getSessionMock.mockReset();
    deleteSessionMock.mockReset();
    dispatchHookMock.mockReset();
    informRoomPeersMock.mockReset();
    socketLeaveRoomMock.mockReset();
    getSessionMock.mockResolvedValue(null);
    socketLeaveRoomMock.mockResolvedValue(null);
    deleteSessionMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    resetState();
    vi.useRealTimers();
  });

  describe('socketDisconnecting', () => {
    const socketStub = {} as Socket;

    it('returns early without setting a timer for an ignored reason', async () => {
      await socketDisconnecting({ token: 'tok', reason: 'ping timeout', socket: socketStub });
      expect(disconnectTimers.has('tok')).toBe(false);
      expect(tempDisconnectedSockets.has('tok')).toBe(false);
    });

    it('returns early when no token is supplied', async () => {
      await socketDisconnecting({ token: '', reason: 'transport close', socket: socketStub });
      expect(disconnectTimers.size).toBe(0);
    });

    it('marks the token temp-disconnected and sets a grace timer', async () => {
      await socketDisconnecting({ token: 'tok', reason: 'transport close', socket: socketStub });
      expect(tempDisconnectedSockets.has('tok')).toBe(true);
      expect(disconnectTimers.has('tok')).toBe(true);
    });

    it('does nothing on a second disconnect while already temp-disconnected', async () => {
      await socketDisconnecting({ token: 'tok', reason: 'transport close', socket: socketStub });
      const firstTimer = disconnectTimers.get('tok');
      await socketDisconnecting({ token: 'tok', reason: 'transport close', socket: socketStub });
      //? Early return on tempDisconnectedSockets membership -> timer untouched.
      expect(disconnectTimers.get('tok')).toBe(firstTimer);
    });

    it('uses transportCloseMs for an allowed reason', async () => {
      registerPresenceConfig({ disconnectTimers: { transportCloseMs: 60_000, defaultMs: 2000 } });
      await socketDisconnecting({ token: 'tok', reason: 'transport close', socket: socketStub });
      //? Timer should not fire before its window elapses.
      await vi.advanceTimersByTimeAsync(2000);
      expect(socketLeaveRoomMock).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(58_000);
      expect(socketLeaveRoomMock).toHaveBeenCalledOnce();
    });

    it('uses defaultMs for an unrecognized reason', async () => {
      await socketDisconnecting({ token: 'tok', reason: 'something weird', socket: socketStub });
      await vi.advanceTimersByTimeAsync(1999);
      expect(socketLeaveRoomMock).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(socketLeaveRoomMock).toHaveBeenCalledOnce();
    });

    it('uses tabSwitchMs and skips session deletion when the client switched tab', async () => {
      clientSwitchedTab.add('tok');
      await socketDisconnecting({ token: 'tok', reason: 'transport close', socket: socketStub });
      //? clientSwitchedTab consumed (deleted) on read.
      expect(clientSwitchedTab.has('tok')).toBe(false);
      //? tabSwitchMs (20s) wins over transportCloseMs because the tab-switch
      //? flag short-circuits getDisconnectTime.
      await vi.advanceTimersByTimeAsync(20_000);
      expect(socketLeaveRoomMock).toHaveBeenCalledOnce();
      //? deleteSessionOnDisconnect=false -> session is preserved across the
      //? short tab-switch reconnect window.
      expect(deleteSessionMock).not.toHaveBeenCalled();
    });

    it('on expiry leaves the room and deletes the session for a normal disconnect', async () => {
      await socketDisconnecting({ token: 'tok', reason: 'transport close', socket: socketStub });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(socketLeaveRoomMock).toHaveBeenCalledWith({ token: 'tok', socket: socketStub, newPath: null });
      expect(deleteSessionMock).toHaveBeenCalledWith('tok');
      //? The grace window is over; the temp-disconnect flag is cleared.
      expect(tempDisconnectedSockets.has('tok')).toBe(false);
    });

    it('does not tear down if the token reconnected (temp flag cleared) before expiry', async () => {
      await socketDisconnecting({ token: 'tok', reason: 'transport close', socket: socketStub });
      //? Simulate a reconnect clearing the temp-disconnect flag.
      tempDisconnectedSockets.delete('tok');
      await vi.advanceTimersByTimeAsync(60_000);
      expect(socketLeaveRoomMock).not.toHaveBeenCalled();
      expect(deleteSessionMock).not.toHaveBeenCalled();
    });

    it('does not tear down if a newer timer replaced this one before expiry', async () => {
      await socketDisconnecting({ token: 'tok', reason: 'transport close', socket: socketStub });
      //? Replace the stored timer with a different one while keeping the temp
      //? flag set; the original callback should bail on the identity check.
      const stale = disconnectTimers.get('tok');
      const replacement = setTimeout(() => {}, 999_999);
      disconnectTimers.set('tok', replacement);
      expect(disconnectTimers.get('tok')).not.toBe(stale);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(socketLeaveRoomMock).not.toHaveBeenCalled();
      clearTimeout(replacement);
    });
  });

  describe('socketConnected', () => {
    it('is a no-op (no reconnect hook) when there was no pending timer', async () => {
      getSessionMock.mockResolvedValue({ id: 'u1', roomCodes: ['room-1'] });
      await socketConnected({ token: 'tok', io: ioStub });
      expect(dispatchHookMock).not.toHaveBeenCalledWith('postSocketReconnect', expect.anything());
    });

    it('clears the pending disconnect timer and temp flag on reconnect', async () => {
      tempDisconnectedSockets.add('tok');
      disconnectTimers.set('tok', setTimeout(() => {}, 999_999));
      getSessionMock.mockResolvedValue(null);
      await socketConnected({ token: 'tok', io: ioStub });
      expect(disconnectTimers.has('tok')).toBe(false);
      expect(tempDisconnectedSockets.has('tok')).toBe(false);
    });

    it('fires postSocketReconnect with userId + filtered roomCodes on reconnect', async () => {
      disconnectTimers.set('tok', setTimeout(() => {}, 999_999));
      getSessionMock.mockResolvedValue({ id: 'u1', roomCodes: ['room-1', '', 42, 'room-2'] });
      await socketConnected({ token: 'tok', io: ioStub });
      expect(dispatchHookMock).toHaveBeenCalledWith('postSocketReconnect', {
        token: 'tok',
        userId: 'u1',
        roomCodes: ['room-1', 'room-2'],
      });
    });

    it('notifies room peers with userBack when reconnecting into a room with a user', async () => {
      disconnectTimers.set('tok', setTimeout(() => {}, 999_999));
      getSessionMock.mockResolvedValue({ id: 'u1', roomCodes: ['room-1'] });
      await socketConnected({ token: 'tok', io: ioStub });
      expect(informRoomPeersMock).toHaveBeenCalledWith({
        token: 'tok',
        io: ioStub,
        event: 'userBack',
        extraData: { ignoreSelf: true },
      });
    });

    it('does not notify peers when the session has no room codes', async () => {
      disconnectTimers.set('tok', setTimeout(() => {}, 999_999));
      getSessionMock.mockResolvedValue({ id: 'u1', roomCodes: [] });
      await socketConnected({ token: 'tok', io: ioStub });
      expect(informRoomPeersMock).not.toHaveBeenCalled();
    });

    it('does not notify peers when there is a room but no userId', async () => {
      disconnectTimers.set('tok', setTimeout(() => {}, 999_999));
      getSessionMock.mockResolvedValue({ id: null, roomCodes: ['room-1'] });
      await socketConnected({ token: 'tok', io: ioStub });
      expect(informRoomPeersMock).not.toHaveBeenCalled();
    });
  });

  describe('initActivityBroadcaster', () => {
    it('registers an intentionalDisconnect listener that flags a tab switch and disconnects', async () => {
      let handler: (() => Promise<void>) | undefined;
      const disconnect = vi.fn();
      const socket = {
        on: vi.fn((event: string, cb: () => Promise<void>) => {
          if (event === 'intentionalDisconnect') handler = cb;
        }),
        disconnect,
      } as unknown as Socket;

      initActivityBroadcaster({ token: 'tok', socket });
      expect(socket.on).toHaveBeenCalledWith('intentionalDisconnect', expect.any(Function));
      expect(handler).toBeDefined();

      informRoomPeersMock.mockResolvedValue(undefined);
      await handler?.();

      expect(clientSwitchedTab.has('tok')).toBe(true);
      //? tabSwitch path: getDisconnectTime returns tabSwitchMs (20s) once the
      //? flag is set, and that value is forwarded as extraData.time.
      expect(informRoomPeersMock).toHaveBeenCalledWith({
        token: 'tok',
        event: 'userAfk',
        extraData: { time: 20_000 },
      });
      expect(disconnect).toHaveBeenCalledWith(false);
    });
  });
});
