import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

//? S22 / S13 — transport behavior tests for the two sync entry points. The
//? entire `@luckystack/core` surface is mocked so the handlers run in isolation
//? with controllable config, session, route maps, and io instance. Three
//? properties are locked in here:
//?
//?   1. S22 — the HTTP/SSE fallback (`handleHttpSyncRequest`) returns the SAME
//?      `{ status, message, result }` envelope the Socket.io ack
//?      (`handleSyncRequest`) emits. The socket shape is canonical; HTTP no
//?      longer flattens `serverOutput` to the top level.
//?   2. S13 — the per-request AbortController is registered under a SERVER-issued
//?      unique id, never the client-controlled `cb` (which is reused across
//?      concurrent same-route requests). The id is handed to the client via a
//?      `{ __cancelId }` handshake on the progress channel.
//?   3. The strict receiver-auth default (membership required, no `'all'`
//?      broadcast) rejects an anonymous / non-member request on BOTH transports.

// ─── Hoisted mock state ──────────────────────────────────────────────────────

interface MockConfig {
  logging: { devLogs: boolean; stream: boolean };
  rateLimiting: { defaultApiLimit: number; defaultIpLimit: number; windowMs: number };
  http: { trustProxy: boolean };
  sync: {
    allowClientReceiverAll: boolean;
    requireRoomMembership: boolean;
    fanoutYieldEvery: number;
    fanoutYieldMs: number;
  };
}

const state = vi.hoisted((): {
  config: MockConfig;
  session: Record<string, unknown> | null;
  syncObject: Record<string, unknown>;
  registerCalls: { socketId: string; cb: string }[];
} => {
  return {
    config: {
      logging: { devLogs: false, stream: false },
      rateLimiting: { defaultApiLimit: 0, defaultIpLimit: 0, windowMs: 1000 },
      http: { trustProxy: false },
      sync: {
        //? Match the actual 0.2.0 production secure defaults so the test
        //? baseline validates what ships (audit finding SYNC-medium-4).
        allowClientReceiverAll: false,
        requireRoomMembership: true,
        fanoutYieldEvery: 50,
        fanoutYieldMs: 0,
      },
    },
    session: null,
    syncObject: {},
    registerCalls: [],
  };
});

//? One shared logger double so a test can assert on dev warnings.
const logger = vi.hoisted(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }));

const tryCatch = vi.hoisted(() =>
  vi.fn((fn: () => Promise<unknown>): Promise<[unknown, unknown]> =>
    fn().then(
      (result): [unknown, unknown] => [null, result],
      (error: unknown): [unknown, unknown] => [error, null],
    ),
  ),
);

vi.mock("@luckystack/core", () => {
  return {
    tryCatch,
    getProjectConfig: () => state.config,
    getIoInstance: vi.fn(() => null),
    readSession: vi.fn(() => Promise.resolve(state.session)),
    getRuntimeSyncMaps: vi.fn(() =>
      Promise.resolve({ syncObject: state.syncObject, functionsObject: {} }),
    ),
    validateRequest: vi.fn(() => ({ status: "success" as const })),
    validateInputByType: vi.fn(() => Promise.resolve({ status: "success" as const })),
    parseTransportRouteName: vi.fn(({ value }: { value: string }) => ({
      status: "success" as const,
      normalizedFullName: value,
      serviceRoute: { normalizedRouteName: value.replace(/^sync\//, "").replace(/\/v\d+$/, "") },
      version: "v1",
    })),
    checkRateLimit: vi.fn(() => Promise.resolve({ allowed: true, resetIn: 0 })),
    dispatchHook: vi.fn(() => Promise.resolve({ stopped: false as const })),
    getLogger: () => logger,
    extractTokenFromSocket: vi.fn(() => null),
    extractLanguageFromHeader: vi.fn(() => null),
    normalizeErrorResponse: vi.fn(({ response }: { response: Record<string, unknown> }) => ({
      status: "error",
      message: typeof response.errorCode === "string" ? response.errorCode : "error",
      errorCode: response.errorCode,
      errorParams: response.errorParams,
      httpStatus: response.httpStatus,
    })),
    applyErrorFormatter: vi.fn(({ response }: { response: unknown }) => response),
    formatRoomName: vi.fn((room: string) => room),
    resolveClientIp: vi.fn(() => "127.0.0.1"),
    runWithErrorTrackerIdentityScope: vi.fn((fn: () => unknown) => fn()),
    setCurrentErrorTrackerIdentity: vi.fn(),
    registerSyncAbortController: vi.fn((socketId: string, cb: string) => {
      state.registerCalls.push({ socketId, cb });
      return `${socketId}:${cb}`;
    }),
    unregisterSyncAbortController: vi.fn(),
    buildSyncProgressEventName: (i: number | string) => `sync-progress-${String(i)}`,
    buildSyncResponseEventName: (i: number | string) => `sync-${String(i)}`,
    socketEventNames: { sync: "sync", disconnect: "disconnect" },
  };
});

import handleSyncRequest from "./handleSyncRequest";
import handleHttpSyncRequest from "./handleHttpSyncRequest";

// ─── Test doubles ────────────────────────────────────────────────────────────

interface RecordedEmit {
  event: string;
  payload: unknown;
}

const makeRecipientSocket = (): {
  id: string;
  handshake: { headers: Record<string, unknown> };
  emit: ReturnType<typeof vi.fn>;
} => ({
  id: "recipient-1",
  handshake: { headers: {} },
  emit: vi.fn(),
});

const makeIoInstance = (recipients: ReturnType<typeof makeRecipientSocket>[]) => ({
  fetchSockets: vi.fn(() => Promise.resolve(recipients)),
  in: vi.fn(() => ({ fetchSockets: vi.fn(() => Promise.resolve(recipients)) })),
});

interface OriginatorDouble {
  id: string;
  rooms: Set<string>;
  handshake: { address: string; headers: Record<string, unknown> };
  emit: ReturnType<typeof vi.fn>;
  once: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  _emits: RecordedEmit[];
}

const makeOriginatorSocket = (id: string, joinedRooms: string[]): OriginatorDouble => {
  const emits: RecordedEmit[] = [];
  return {
    id,
    rooms: new Set(joinedRooms),
    handshake: { address: "127.0.0.1", headers: {} },
    emit: vi.fn((event: string, payload: unknown) => {
      emits.push({ event, payload });
    }),
    once: vi.fn(),
    off: vi.fn(),
    _emits: emits,
  };
};

type SocketArg = Parameters<typeof handleSyncRequest>[0]["socket"];

//? The structural double implements only the members the handlers touch
//? (id/rooms/handshake/emit/once/off) — a tiny subset of socket.io's `Socket`.
//? A single boundary assertion through `unknown` is the documented test seam;
//? both the double-cast guard and `consistent-type-assertions` are disabled
//? here with this rationale (per CLAUDE.md's "structurally-impossible cases get
//? an inline disable with a WHY comment").
const asSocketArg = (socket: OriginatorDouble): SocketArg =>
  // eslint-disable-next-line no-restricted-syntax, @typescript-eslint/consistent-type-assertions -- socket.io Socket test double boundary; the double covers only the members both handlers touch
  socket as unknown as SocketArg;

const serverEntry = (output: Record<string, unknown>) => ({
  auth: { login: false, additional: [] },
  main: vi.fn(() => Promise.resolve(output)),
  validation: "relaxed" as const,
});

let mockedCore: typeof import("@luckystack/core");

beforeEach(async () => {
  mockedCore = await import("@luckystack/core");
  vi.clearAllMocks();
  state.registerCalls.length = 0;
  state.session = null;
  state.syncObject = {};
  state.config.sync = {
    //? Mirror the hoisted baseline: secure production defaults.
    allowClientReceiverAll: false,
    requireRoomMembership: true,
    fanoutYieldEvery: 50,
    fanoutYieldMs: 0,
  };
});

// ─── S22: transport parity ───────────────────────────────────────────────────

describe("S22 — unified response envelope across transports", () => {
  it("socket ack and HTTP return the SAME { status, message, result } shape", async () => {
    const SERVER_OUTPUT = { status: "success" as const, message: "route message", token: "tok", count: 7 };
    state.syncObject = { "sync/chat/send/v1_server": serverEntry(SERVER_OUTPUT) };

    // ── Socket transport ──
    const recipients = [makeRecipientSocket()];
    const io = makeIoInstance(recipients);
    (mockedCore.getIoInstance as ReturnType<typeof vi.fn>).mockReturnValue(io);

    const originator = makeOriginatorSocket("sock-A", ["chat-room"]);
    await handleSyncRequest({
      msg: {
        name: "sync/chat/send/v1",
        data: { hello: "world" },
        cb: "chat/send/v1",
        receiver: "chat-room",
        responseIndex: 1,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- socket double
      socket: asSocketArg(originator),
      token: "tokenA",
    });

    const ack = originator._emits.find((e) => e.event === "sync-1");
    expect(ack).toBeDefined();
    expect(ack?.payload).toEqual({
      status: "success",
      message: "sync sync/chat/send/v1 success",
      result: SERVER_OUTPUT,
    });

    // ── HTTP transport ──
    //? Set a session that has joined "chat-room" so the requireRoomMembership
    //? secure default passes (same membership check as the socket transport's
    //? socket.rooms.has(receiver) check above).
    state.session = { id: "u-s22", roomCodes: ["chat-room"] };
    const httpResult = await handleHttpSyncRequest({
      name: "sync/chat/send/v1",
      data: { hello: "world" },
      receiver: "chat-room",
      token: "tokenA",
      requesterIp: "127.0.0.1",
    });

    // Same canonical envelope: serverOutput nested under `result`, NOT flattened.
    expect(httpResult).toEqual({
      status: "success",
      message: "route message",
      result: SERVER_OUTPUT,
    });
    expect(httpResult.result).toEqual(SERVER_OUTPUT);
    // Regression guard for the old flattened shape — top-level route fields gone.
    //? `HttpSyncResponse` is a closed interface without those keys, so probe via
    //? `unknown` to assert their structural ABSENCE (no index signature on the
    //? envelope to widen — that's the point of the regression guard).
    const httpFields = httpResult as unknown as Record<string, unknown>;
    expect(httpFields.token).toBeUndefined();
    expect(httpFields.count).toBeUndefined();
  });
});

// ─── HTTP transport rejects an ARRAY clientInput (parity with socket) ─────────

describe("HTTP transport rejects an ARRAY clientInput (socket parity)", () => {
  it("HTTP: array data → sync.invalidRequest, matching the socket Array.isArray guard", async () => {
    state.syncObject = {
      "sync/chat/send/v1_server": serverEntry({ status: "success" as const, message: "ok" }),
    };
    //? `typeof [] === 'object'` lets an array slip past the route's normalize step;
    //? the socket transport rejects it via validateSyncMessage's Array.isArray
    //? check, so the HTTP transport must reject it identically (not pass it to a
    //? `_server` handler expecting an object).
    const result = await handleHttpSyncRequest({
      name: "sync/chat/send/v1",
      data: [1, 2, 3] as unknown as Record<string, unknown>, // luckystack-allow no-as-any: test simulates an untyped wire array payload the runtime guard must reject
      receiver: "chat-room",
      token: "tokenA",
      requesterIp: "127.0.0.1",
    });
    expect(result.status).toBe("error");
    expect((result as { errorCode?: string }).errorCode).toBe("sync.invalidRequest");
  });
});

// ─── S13: syncCancel keyed on a server-issued id ─────────────────────────────

describe("S13 — abort registry keyed on a server-issued cancel id", () => {
  it("registers two concurrent same-route requests under DISTINCT server ids (not the reused cb)", async () => {
    state.syncObject = {
      "sync/chat/send/v1_server": serverEntry({ status: "success" as const, message: "ok" }),
    };
    const io = makeIoInstance([makeRecipientSocket()]);
    (mockedCore.getIoInstance as ReturnType<typeof vi.fn>).mockReturnValue(io);

    const REUSED_CB = "chat/send/v1";
    const sock1 = makeOriginatorSocket("sock-A", ["chat-room"]);
    const sock2 = makeOriginatorSocket("sock-A", ["chat-room"]);

    await Promise.all([
      handleSyncRequest({
        msg: { name: "sync/chat/send/v1", data: {}, cb: REUSED_CB, receiver: "chat-room", responseIndex: 1 },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- socket double
        socket: asSocketArg(sock1),
        token: "tokenA",
      }),
      handleSyncRequest({
        msg: { name: "sync/chat/send/v1", data: {}, cb: REUSED_CB, receiver: "chat-room", responseIndex: 2 },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- socket double
        socket: asSocketArg(sock2),
        token: "tokenA",
      }),
    ]);

    expect(state.registerCalls).toHaveLength(2);
    const first = state.registerCalls[0];
    const second = state.registerCalls[1];
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    // The registry key must NOT be the client-controlled, reused callback name.
    expect(first?.cb).not.toBe(REUSED_CB);
    expect(second?.cb).not.toBe(REUSED_CB);
    // Each request gets its OWN server-issued id — no registry collision.
    expect(first?.cb).not.toBe(second?.cb);
  });

  it("hands the server-issued cancel id to the client via a { __cancelId } progress handshake", async () => {
    state.syncObject = {
      "sync/chat/send/v1_server": serverEntry({ status: "success" as const, message: "ok" }),
    };
    const io = makeIoInstance([makeRecipientSocket()]);
    (mockedCore.getIoInstance as ReturnType<typeof vi.fn>).mockReturnValue(io);

    const originator = makeOriginatorSocket("sock-A", ["chat-room"]);
    await handleSyncRequest({
      msg: { name: "sync/chat/send/v1", data: {}, cb: "chat/send/v1", receiver: "chat-room", responseIndex: 9 },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- socket double
      socket: asSocketArg(originator),
      token: "tokenA",
    });

    const handshake = originator._emits.find((e) => e.event === "sync-progress-9");
    expect(handshake).toBeDefined();
    const cancelId = (handshake?.payload as { __cancelId?: string }).__cancelId;
    expect(typeof cancelId).toBe("string");
    // The id emitted to the client is exactly the one registered server-side.
    expect(state.registerCalls[0]?.cb).toBe(cancelId);
  });
});

// ─── Strict receiver-auth default ────────────────────────────────────────────

describe("strict receiver-auth default — anonymous / non-member denied", () => {
  beforeEach(() => {
    //? Mirror core's 0.2.0 DEFAULT_PROJECT_CONFIG.sync strict defaults.
    state.config.sync = {
      allowClientReceiverAll: false,
      requireRoomMembership: true,
      fanoutYieldEvery: 50,
      fanoutYieldMs: 0,
    };
    state.syncObject = {
      "sync/chat/send/v1_server": serverEntry({ status: "success" as const, message: "ok" }),
    };
  });

  it("socket: rejects a non-member room with sync.notRoomMember (403)", async () => {
    const io = makeIoInstance([makeRecipientSocket()]);
    (mockedCore.getIoInstance as ReturnType<typeof vi.fn>).mockReturnValue(io);

    // Originator has NOT joined "chat-room".
    const originator = makeOriginatorSocket("sock-A", []);
    await handleSyncRequest({
      msg: { name: "sync/chat/send/v1", data: {}, cb: "chat/send/v1", receiver: "chat-room", responseIndex: 1 },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- socket double
      socket: asSocketArg(originator),
      token: "tokenA",
    });

    const ack = originator._emits.find((e) => e.event === "sync-1");
    expect((ack?.payload as { errorCode?: string }).errorCode).toBe("sync.notRoomMember");
    expect((ack?.payload as { httpStatus?: number }).httpStatus).toBe(403);
  });

  it("HTTP: an anonymous caller (no session) fails closed with sync.notRoomMember", async () => {
    const io = makeIoInstance([]);
    (mockedCore.getIoInstance as ReturnType<typeof vi.fn>).mockReturnValue(io);
    state.session = null; // anonymous → membership undeterminable

    const result = await handleHttpSyncRequest({
      name: "sync/chat/send/v1",
      data: {},
      receiver: "chat-room",
      token: null,
      requesterIp: "127.0.0.1",
    });

    expect(result.status).toBe("error");
    expect(result.errorCode).toBe("sync.notRoomMember");
    expect(result.httpStatus).toBe(403);
  });

  it("HTTP: rejects the 'all' broadcast when allowClientReceiverAll is false", async () => {
    const io = makeIoInstance([]);
    (mockedCore.getIoInstance as ReturnType<typeof vi.fn>).mockReturnValue(io);
    state.session = { id: "u1", roomCodes: [] };

    const result = await handleHttpSyncRequest({
      name: "sync/chat/send/v1",
      data: {},
      receiver: "all",
      token: "tokenA",
      requesterIp: "127.0.0.1",
    });

    expect(result.status).toBe("error");
    expect(result.errorCode).toBe("sync.receiverNotAllowed");
  });

  it("HTTP: a session member of the room is allowed through", async () => {
    //? One recipient: since 0.10.0 an EMPTY room is `sync.noReceiversFound` on
    //? HTTP too (see the fan-out parity block below); this test is about auth.
    const io = makeIoInstance([makeRecipientSocket()]);
    (mockedCore.getIoInstance as ReturnType<typeof vi.fn>).mockReturnValue(io);
    state.session = { id: "u1", roomCodes: ["chat-room"] };

    const result = await handleHttpSyncRequest({
      name: "sync/chat/send/v1",
      data: {},
      receiver: "chat-room",
      token: "tokenA",
      requesterIp: "127.0.0.1",
    });

    expect(result.status).toBe("success");
    expect(result.result).toEqual({ status: "success", message: "ok" });
  });
});

// ─── 0.10.0 — HTTP fan-out parity, membership warning, recipientToken ────────

describe("0.10.0 — HTTP fan-out parity with the socket transport", () => {
  const SERVER_OUTPUT = { status: "success" as const, message: "ok" };

  beforeEach(() => {
    state.syncObject = { "sync/chat/send/v1_server": serverEntry(SERVER_OUTPUT) };
    state.session = { id: "u1", roomCodes: ["chat-room"] };
    (mockedCore.extractTokenFromSocket as ReturnType<typeof vi.fn>).mockImplementation(
      (socket: { id?: string }) => (socket.id === "recipient-1" ? "tokenB" : null),
    );
  });

  afterEach(() => {
    state.config.logging.devLogs = false;
    (mockedCore.extractTokenFromSocket as ReturnType<typeof vi.fn>).mockImplementation(() => null);
  });

  const hookNames = (): string[] =>
    (mockedCore.dispatchHook as ReturnType<typeof vi.fn>).mock.calls.map((call) => String(call[0]));

  it("HTTP: an EMPTY room is sync.noReceiversFound (404), before the _server runs and before preSyncFanout", async () => {
    const io = makeIoInstance([]);
    (mockedCore.getIoInstance as ReturnType<typeof vi.fn>).mockReturnValue(io);
    const entry = serverEntry(SERVER_OUTPUT);
    state.syncObject = { "sync/chat/send/v1_server": entry };

    const result = await handleHttpSyncRequest({
      name: "sync/chat/send/v1",
      data: {},
      receiver: "chat-room",
      token: "tokenA",
      requesterIp: "127.0.0.1",
    });

    expect(result.status).toBe("error");
    expect(result.errorCode).toBe("sync.noReceiversFound");
    expect(result.httpStatus).toBe(404);
    //? Recipients are resolved BEFORE the server handler (parity with socket), so
    //? nothing was persisted and the error is a true pre-commit rejection.
    expect(entry.main).not.toHaveBeenCalled();
    //? Same position as the socket handler: before the fan-out hooks.
    expect(hookNames()).not.toContain("preSyncFanout");
    expect(hookNames()).not.toContain("postSyncFanout");
  });

  it("HTTP: dev-warns when membership passed on roomCodes but the caller has no socket in the room", async () => {
    state.config.logging.devLogs = true;
    const io = makeIoInstance([makeRecipientSocket()]);
    (mockedCore.getIoInstance as ReturnType<typeof vi.fn>).mockReturnValue(io);

    const result = await handleHttpSyncRequest({
      name: "sync/chat/send/v1",
      data: {},
      receiver: "chat-room",
      token: "tokenA",
      requesterIp: "127.0.0.1",
    });

    expect(result.status).toBe("success");
    const warning = logger.warn.mock.calls.find((call) => String(call[0]).includes("no socket in"));
    expect(warning).toBeDefined();
    expect(String(warning?.[0])).toContain('"chat-room"');
  });

  it("HTTP: no membership warning when one of the caller's own sockets is in the room", async () => {
    state.config.logging.devLogs = true;
    (mockedCore.extractTokenFromSocket as ReturnType<typeof vi.fn>).mockImplementation(() => "tokenA");
    const io = makeIoInstance([makeRecipientSocket()]);
    (mockedCore.getIoInstance as ReturnType<typeof vi.fn>).mockReturnValue(io);

    await handleHttpSyncRequest({
      name: "sync/chat/send/v1",
      data: {},
      receiver: "chat-room",
      token: "tokenA",
      requesterIp: "127.0.0.1",
    });

    expect(logger.warn.mock.calls.some((call) => String(call[0]).includes("no socket in"))).toBe(false);
  });

  it("HTTP + socket: preSyncRecipient carries the recipient's token; recipientUserId stays null", async () => {
    const io = makeIoInstance([makeRecipientSocket()]);
    (mockedCore.getIoInstance as ReturnType<typeof vi.fn>).mockReturnValue(io);

    await handleHttpSyncRequest({
      name: "sync/chat/send/v1",
      data: {},
      receiver: "chat-room",
      token: "tokenA",
      requesterIp: "127.0.0.1",
    });

    const originator = makeOriginatorSocket("sock-A", ["chat-room"]);
    await handleSyncRequest({
      msg: { name: "sync/chat/send/v1", data: {}, cb: "chat/send/v1", receiver: "chat-room", responseIndex: 1 },
      socket: asSocketArg(originator),
      token: "tokenA",
    });

    const recipientPayloads = (mockedCore.dispatchHook as ReturnType<typeof vi.fn>).mock.calls
      .filter((call) => call[0] === "preSyncRecipient")
      .map((call) => call[1] as { recipientSocketId: string; recipientToken: string | null; recipientUserId: string | null });
    expect(recipientPayloads).toHaveLength(2);
    for (const payload of recipientPayloads) {
      expect(payload.recipientSocketId).toBe("recipient-1");
      expect(payload.recipientToken).toBe("tokenB");
      expect(payload.recipientUserId).toBeNull();
    }
  });
});

// ─── Recipients are resolved BEFORE the server handler persists anything ──────
//? A `fetchSockets()` that fails (the Redis adapter's `requestsTimeout` when an
//? instance on the channel does not answer) or comes back empty used to surface
//? AFTER `_server` had run: the caller was told `error` about a mutation that
//? had been saved, and a retry applied it twice. Both transports now resolve
//? the recipients first, so every error on this path is a pre-commit rejection.
describe("recipients resolve before _server — a fan-out failure never masks a committed mutation", () => {
  const SERVER_OUTPUT = { status: "success" as const, message: "ok" };
  const FETCH_TIMEOUT = new Error("timeout reached while waiting for fetchSockets response");

  const makeTimingOutIoInstance = () => ({
    fetchSockets: vi.fn(() => Promise.reject(FETCH_TIMEOUT)),
    in: vi.fn(() => ({ fetchSockets: vi.fn(() => Promise.reject(FETCH_TIMEOUT)) })),
  });

  let entry: ReturnType<typeof serverEntry>;

  beforeEach(() => {
    entry = serverEntry(SERVER_OUTPUT);
    state.syncObject = { "sync/chat/send/v1_server": entry };
    state.session = { id: "u1", roomCodes: ["chat-room"] };
  });

  it("socket: a fetchSockets timeout is sync.serverExecutionFailed and the _server handler never ran", async () => {
    (mockedCore.getIoInstance as ReturnType<typeof vi.fn>).mockReturnValue(makeTimingOutIoInstance());
    const originator = makeOriginatorSocket("sock-A", ["chat-room"]);

    await handleSyncRequest({
      msg: { name: "sync/chat/send/v1", data: {}, cb: "chat/send/v1", receiver: "chat-room", responseIndex: 1 },
      socket: asSocketArg(originator),
      token: "tokenA",
    });

    const ack = originator._emits.find((e) => e.event === "sync-1");
    expect(ack?.payload).toMatchObject({ status: "error", errorCode: "sync.serverExecutionFailed" });
    expect(entry.main).not.toHaveBeenCalled();
  });

  it("socket: an EMPTY room is sync.noReceiversFound and the _server handler never ran", async () => {
    (mockedCore.getIoInstance as ReturnType<typeof vi.fn>).mockReturnValue(makeIoInstance([]));
    const originator = makeOriginatorSocket("sock-A", ["chat-room"]);

    await handleSyncRequest({
      msg: { name: "sync/chat/send/v1", data: {}, cb: "chat/send/v1", receiver: "chat-room", responseIndex: 1 },
      socket: asSocketArg(originator),
      token: "tokenA",
    });

    const ack = originator._emits.find((e) => e.event === "sync-1");
    expect(ack?.payload).toMatchObject({ status: "error", errorCode: "sync.noReceiversFound" });
    expect(entry.main).not.toHaveBeenCalled();
  });

  it("HTTP: a fetchSockets timeout is sync.serverExecutionFailed and the _server handler never ran", async () => {
    (mockedCore.getIoInstance as ReturnType<typeof vi.fn>).mockReturnValue(makeTimingOutIoInstance());

    const result = await handleHttpSyncRequest({
      name: "sync/chat/send/v1",
      data: {},
      receiver: "chat-room",
      token: "tokenA",
      requesterIp: "127.0.0.1",
    });

    expect(result.status).toBe("error");
    expect(result.errorCode).toBe("sync.serverExecutionFailed");
    expect(entry.main).not.toHaveBeenCalled();
  });

  it("both transports: with recipients present the _server handler runs exactly once and the originator gets success", async () => {
    (mockedCore.getIoInstance as ReturnType<typeof vi.fn>).mockReturnValue(makeIoInstance([makeRecipientSocket()]));
    const originator = makeOriginatorSocket("sock-A", ["chat-room"]);

    await handleSyncRequest({
      msg: { name: "sync/chat/send/v1", data: {}, cb: "chat/send/v1", receiver: "chat-room", responseIndex: 1 },
      socket: asSocketArg(originator),
      token: "tokenA",
    });
    const ack = originator._emits.find((e) => e.event === "sync-1");
    expect(ack?.payload).toMatchObject({ status: "success" });
    expect(entry.main).toHaveBeenCalledTimes(1);

    const result = await handleHttpSyncRequest({
      name: "sync/chat/send/v1",
      data: {},
      receiver: "chat-room",
      token: "tokenA",
      requesterIp: "127.0.0.1",
    });
    expect(result.status).toBe("success");
    expect(entry.main).toHaveBeenCalledTimes(2);
  });
});
