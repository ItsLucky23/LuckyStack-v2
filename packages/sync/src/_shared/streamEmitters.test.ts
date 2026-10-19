import { describe, it, expect, vi, beforeEach } from "vitest";

//? `buildSyncStreamEmitters` is the in-package fanout/emit layer. Its pure,
//? DI-injectable seams are mocked here: `getIoInstance` (the Socket.io server
//? slot), `getProjectConfig` (log toggles), `getLogger`, and `dispatchHook`.
//? No real socket/io/redis is constructed — every "socket" is a vi.fn-backed
//? stub, so we test the routing math (solo-room unicast vs multi-room fanout),
//? frame shape, token filtering, and the abort short-circuit in isolation.

interface SocketStub {
  emit: ReturnType<typeof vi.fn>;
}

interface RoomEmitter {
  emit: ReturnType<typeof vi.fn>;
}

interface IoStub {
  to: ReturnType<typeof vi.fn>;
  //? `io.emit` — every socket in the cluster (receiver 'all').
  emit: ReturnType<typeof vi.fn>;
  //? The single `emit` spy shared by every `io.to(...)` return so tests can
  //? assert what was broadcast without digging into `to.mock.results` (whose
  //? `.value` is typed `any` by vitest and would trip the no-unsafe lint).
  roomEmit: ReturnType<typeof vi.fn>;
  sockets: {
    sockets: Map<string, SocketStub>;
    adapter: { rooms: Map<string, Set<string>> };
  };
}

let ioInstance: IoStub | null = null;
//? Stable logger + stream-log toggle so a test can enable stream logging and
//? assert what `getLogger().debug` was called with (token redaction).
const loggerDebug = vi.fn();
let streamLogEnabled = false;
const identityFormatter = (room: string): string => room;
let roomFormatter = identityFormatter;

const makeSocket = (): SocketStub => ({ emit: vi.fn() });

const makeIo = (): IoStub => {
  const roomEmit = vi.fn();
  return {
    to: vi.fn((): RoomEmitter => ({ emit: roomEmit })),
    emit: vi.fn(),
    roomEmit,
    sockets: {
      sockets: new Map<string, SocketStub>(),
      adapter: { rooms: new Map<string, Set<string>>() },
    },
  };
};

//? Non-throwing accessor that narrows away the `IoStub | null` union without a
//? non-null assertion (which the repo lints as a warning under a zero-warning
//? policy). Every test sets `ioInstance` in `beforeEach`, so a null here is a
//? genuine test-setup bug worth surfacing.
const getIo = (): IoStub => {
  if (!ioInstance) throw new Error("test io instance not initialised");
  return ioInstance;
};

vi.mock("@luckystack/core", () => ({
  getIoInstance: () => ioInstance,
  getProjectConfig: () => ({ logging: { stream: streamLogEnabled } }),
  getLogger: () => ({ debug: loggerDebug, info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  dispatchHook: vi.fn(),
  socketEventNames: { sync: "sync" },
  //? Identity formatter by default (matches the default `defaultRoomNameFormatter`)
  //? so the broadcast-room assertions below still target the raw room code; a
  //? test swaps in a prefixing formatter to model a consumer-registered one.
  formatRoomName: (room: string) => roomFormatter(room),
}));

import { buildSyncStreamEmitters } from "./streamEmitters";

const OWN_TOKEN = "own-session-token-0123456789";

const makeBaseArgs = () => ({
  receiver: "room-A",
  token: OWN_TOKEN as string | null,
  resolvedName: "sync/chat/sendMessage/v1",
  logLabel: "sync",
  emitOriginatorChunk: vi.fn(),
});

describe("buildSyncStreamEmitters", () => {
  beforeEach(() => {
    ioInstance = makeIo();
    streamLogEnabled = false;
    roomFormatter = identityFormatter;
    loggerDebug.mockClear();
  });

  describe("buildBroadcastFrame", () => {
    it("wraps a payload with cb, fullName, and stream status", () => {
      const { buildBroadcastFrame } = buildSyncStreamEmitters(makeBaseArgs());

      const frame = buildBroadcastFrame({ text: "hi" });

      expect(frame).toEqual({
        text: "hi",
        cb: "sync/chat/sendMessage/v1",
        fullName: "sync/chat/sendMessage/v1",
        status: "stream",
      });
    });

    //? 003 — recipients fire stream callbacks for both `fullName` and `cb`, so a
    //? frame must never carry a caller-chosen callback name; `cb` is the
    //? server-resolved route, whatever the handler's payload contains.
    it("keys cb on the resolved route even when the payload carries its own cb", () => {
      const { buildBroadcastFrame } = buildSyncStreamEmitters(makeBaseArgs());

      const frame = buildBroadcastFrame({ cb: "billing/progress/v1", chunk: "x" });

      expect(frame.cb).toBe("sync/chat/sendMessage/v1");
      expect(frame.fullName).toBe("sync/chat/sendMessage/v1");
    });

    it("preserves the payload data fields alongside the envelope", () => {
      const { buildBroadcastFrame } = buildSyncStreamEmitters(makeBaseArgs());

      const frame = buildBroadcastFrame({ index: 7, done: false });

      expect(frame.index).toBe(7);
      expect(frame.done).toBe(false);
      expect(frame.status).toBe("stream");
    });
  });

  describe("emitServerSyncStream", () => {
    it("forwards the payload to the originator chunk emitter", () => {
      const emitOriginatorChunk = vi.fn();
      const { emitServerSyncStream } = buildSyncStreamEmitters({ ...makeBaseArgs(), emitOriginatorChunk });

      emitServerSyncStream({ text: "tok" });

      expect(emitOriginatorChunk).toHaveBeenCalledTimes(1);
      expect(emitOriginatorChunk).toHaveBeenCalledWith({ text: "tok" });
    });

    it("defaults to an empty payload when none is given", () => {
      const emitOriginatorChunk = vi.fn();
      const { emitServerSyncStream } = buildSyncStreamEmitters({ ...makeBaseArgs(), emitOriginatorChunk });

      emitServerSyncStream();

      expect(emitOriginatorChunk).toHaveBeenCalledWith({});
    });

    it("short-circuits and emits nothing when the signal is already aborted", () => {
      const controller = new AbortController();
      controller.abort();
      const emitOriginatorChunk = vi.fn();
      const { emitServerSyncStream } = buildSyncStreamEmitters({
        ...makeBaseArgs(),
        emitOriginatorChunk,
        signal: controller.signal,
      });

      emitServerSyncStream({ text: "tok" });

      expect(emitOriginatorChunk).not.toHaveBeenCalled();
    });
  });

  describe("emitBroadcastSyncStream — room fanout math", () => {
    it("broadcasts via io.to(room) even when only one member is connected locally", () => {
      const io = getIo();
      const onlySocket = makeSocket();
      io.sockets.adapter.rooms.set("room-A", new Set(["sock-1"]));
      io.sockets.sockets.set("sock-1", onlySocket);

      const { emitBroadcastSyncStream } = buildSyncStreamEmitters(makeBaseArgs());
      emitBroadcastSyncStream({ text: "solo" });

      //? No local "solo-degrade": the local `adapter.rooms` view only sees
      //? sockets on THIS instance, so unicasting to the lone local socket would
      //? drop members connected to other instances. Always broadcast via
      //? io.to(room) so the Redis adapter fans out cluster-wide.
      expect(io.to).toHaveBeenCalledTimes(1);
      expect(io.to).toHaveBeenCalledWith("room-A");
      expect(io.roomEmit).toHaveBeenCalledWith("sync", {
        text: "solo",
        cb: "sync/chat/sendMessage/v1",
        fullName: "sync/chat/sendMessage/v1",
        status: "stream",
      });
      expect(onlySocket.emit).not.toHaveBeenCalled();
    });

    it("uses io.to(room).emit for a multi-member room", () => {
      const io = getIo();
      io.sockets.adapter.rooms.set("room-A", new Set(["sock-1", "sock-2"]));

      const { emitBroadcastSyncStream } = buildSyncStreamEmitters(makeBaseArgs());
      emitBroadcastSyncStream({ text: "many" });

      expect(io.to).toHaveBeenCalledTimes(1);
      expect(io.to).toHaveBeenCalledWith("room-A");
      expect(io.roomEmit).toHaveBeenCalledWith("sync", {
        text: "many",
        cb: "sync/chat/sendMessage/v1",
        fullName: "sync/chat/sendMessage/v1",
        status: "stream",
      });
    });

    it("still broadcasts via io.to(room) when the room is empty in the LOCAL adapter view", () => {
      const io = getIo();
      io.sockets.adapter.rooms.set("room-A", new Set());

      const { emitBroadcastSyncStream } = buildSyncStreamEmitters(makeBaseArgs());
      emitBroadcastSyncStream({ text: "noone" });

      //? A locally-empty room can still have members on other instances; the
      //? Redis adapter resolves the real recipients. Gating on the local view
      //? here is exactly what broke cross-instance broadcastStream.
      expect(io.to).toHaveBeenCalledTimes(1);
      expect(io.to).toHaveBeenCalledWith("room-A");
    });

    it("still broadcasts via io.to(room) when the room is unknown to the LOCAL adapter", () => {
      const io = getIo();
      const { emitBroadcastSyncStream } = buildSyncStreamEmitters(makeBaseArgs());
      emitBroadcastSyncStream({ text: "ghost" });

      expect(io.to).toHaveBeenCalledTimes(1);
      expect(io.to).toHaveBeenCalledWith("room-A");
    });

    //? 016 — 'all' means every socket (as in the fanout), not a literal room
    //? named 'all' that only deliberate joiners are in.
    it("emits to every socket via io.emit for receiver 'all'", () => {
      const io = getIo();
      const { emitBroadcastSyncStream } = buildSyncStreamEmitters({ ...makeBaseArgs(), receiver: "all" });
      emitBroadcastSyncStream({ text: "everyone" });

      expect(io.to).not.toHaveBeenCalled();
      expect(io.emit).toHaveBeenCalledWith("sync", {
        text: "everyone",
        cb: "sync/chat/sendMessage/v1",
        fullName: "sync/chat/sendMessage/v1",
        status: "stream",
      });
    });

    //? 066 — the caller's own token room is joined RAW, so a prefixing formatter
    //? must not be applied to it; ordinary rooms still are.
    it("addresses the caller's own token room raw under a non-identity formatter", () => {
      roomFormatter = (room) => `tenantA:${room}`;
      const io = getIo();

      buildSyncStreamEmitters({ ...makeBaseArgs(), receiver: OWN_TOKEN }).emitBroadcastSyncStream({ text: "self" });
      buildSyncStreamEmitters(makeBaseArgs()).emitBroadcastSyncStream({ text: "room" });

      expect(io.to).toHaveBeenNthCalledWith(1, OWN_TOKEN);
      expect(io.to).toHaveBeenNthCalledWith(2, "tenantA:room-A");
    });

    it("returns early when receiver is empty (no room to target)", () => {
      const io = getIo();
      io.sockets.adapter.rooms.set("", new Set(["sock-1", "sock-2"]));

      const { emitBroadcastSyncStream } = buildSyncStreamEmitters({ ...makeBaseArgs(), receiver: "" });
      emitBroadcastSyncStream({ text: "x" });

      expect(io.to).not.toHaveBeenCalled();
    });

    it("returns early when no io instance is registered", () => {
      ioInstance = null;
      const { emitBroadcastSyncStream } = buildSyncStreamEmitters(makeBaseArgs());

      //? No throw, nothing to assert beyond not crashing — the guard is the behavior.
      expect(() => {
        emitBroadcastSyncStream({ text: "x" });
      }).not.toThrow();
    });

    it("short-circuits when the signal is aborted", () => {
      const io = getIo();
      const controller = new AbortController();
      controller.abort();
      io.sockets.adapter.rooms.set("room-A", new Set(["sock-1", "sock-2"]));

      const { emitBroadcastSyncStream } = buildSyncStreamEmitters({ ...makeBaseArgs(), signal: controller.signal });
      emitBroadcastSyncStream({ text: "x" });

      expect(io.to).not.toHaveBeenCalled();
    });
  });

  describe("emitStreamToTokens — token filtering", () => {
    it("normalizes a single token string into a one-element room target", () => {
      const io = getIo();
      const { emitStreamToTokens } = buildSyncStreamEmitters(makeBaseArgs());
      emitStreamToTokens("token-1", { text: "hi" });

      expect(io.to).toHaveBeenCalledTimes(1);
      expect(io.to).toHaveBeenCalledWith(["token-1"]);
    });

    it("drops empty and non-string tokens before targeting", () => {
      const io = getIo();
      const { emitStreamToTokens } = buildSyncStreamEmitters(makeBaseArgs());
      emitStreamToTokens(["token-1", "", "token-2"], { text: "hi" });

      expect(io.to).toHaveBeenCalledWith(["token-1", "token-2"]);
    });

    it("emits nothing when every token is filtered out", () => {
      const io = getIo();
      const { emitStreamToTokens } = buildSyncStreamEmitters(makeBaseArgs());
      emitStreamToTokens(["", ""], { text: "hi" });

      expect(io.to).not.toHaveBeenCalled();
    });

    it("targets the filtered tokens with the broadcast frame", () => {
      const io = getIo();
      const { emitStreamToTokens } = buildSyncStreamEmitters(makeBaseArgs());
      emitStreamToTokens(["token-1"], { delta: "d" });

      expect(io.roomEmit).toHaveBeenCalledWith("sync", {
        delta: "d",
        cb: "sync/chat/sendMessage/v1",
        fullName: "sync/chat/sendMessage/v1",
        status: "stream",
      });
    });

    it("short-circuits when the signal is aborted", () => {
      const io = getIo();
      const controller = new AbortController();
      controller.abort();
      const { emitStreamToTokens } = buildSyncStreamEmitters({ ...makeBaseArgs(), signal: controller.signal });

      emitStreamToTokens(["token-1"], { text: "hi" });

      expect(io.to).not.toHaveBeenCalled();
    });

    //? N-4 (SYNC-17): raw bearer session tokens are credentials and must be
    //? redacted before they reach the stream debug log — never logged verbatim.
    it("redacts the raw session tokens in the stream debug log", () => {
      streamLogEnabled = true;
      const { emitStreamToTokens } = buildSyncStreamEmitters(makeBaseArgs());

      emitStreamToTokens(
        ["abcdefghijklmnopqrstuvwxyz", "session-token-0987654321"],
        { text: "hi" },
      );

      expect(loggerDebug).toHaveBeenCalledTimes(1);
      const [, meta] = loggerDebug.mock.calls[0] as [string, { tokens: string[] }];
      //? Truncated to the 4-char prefix — the full token is not recoverable.
      expect(meta.tokens).toEqual(["abcd…", "sess…"]);
      const logged = JSON.stringify(meta.tokens);
      expect(logged).not.toContain("abcdefghijklmnop");
      expect(logged).not.toContain("0987654321");
    });
  });
});
