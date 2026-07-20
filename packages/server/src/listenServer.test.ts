import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Server as HttpServer } from 'node:http';

//? Characterization tests pinning the behaviour of the `listen` logic
//? extracted out of `createLuckyStackServer` into `listenLuckyStackServer`.
//? They cover: successful bind + resolve + callback, parse of a string port,
//? EADDRINUSE failure path (reject, NO success log), the
//? SERVER_PORT_AUTO_INCREMENT retry path (explicit + dev-default), and
//? non-EADDRINUSE pass-through.
//?
//? `coreState.isProduction` is mutable so tests can flip the dev-vs-prod default
//? for the auto-increment resolution. Reset to `true` in beforeEach so each test
//? starts from the prod default (auto-increment off unless opted in).
const { loggerMock, coreState, registerBindAddressMock } = vi.hoisted(() => ({
  loggerMock: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  //? `oauthCallbackBase` is mutable so a test can drive the drift-warning branch.
  coreState: { isProduction: true, oauthCallbackBase: '' },
  registerBindAddressMock: vi.fn(),
}));

vi.mock('@luckystack/core', () => ({
  getLogger: () => loggerMock,
  get isProduction() { return coreState.isProduction; },
  getProjectConfig: () => ({
    logging: { socketStartup: true, devLogs: false },
    oauthCallbackBase: coreState.oauthCallbackBase,
  }),
  registerBindAddress: registerBindAddressMock,
  //? Faithful tuple-shape mock — the drift check calls it to read config defensively.
  tryCatchSync: (fn: () => unknown) => {
    try { return [null, fn()]; } catch (error) { return [error, null]; }
  },
  writeBootUuid: vi.fn(),
  tryCatch: vi.fn(),
}));
vi.mock('./httpHandler', () => ({ handleHttpRequest: vi.fn() }));
vi.mock('./loadSocket', () => ({ loadSocket: vi.fn() }));
vi.mock('./verifyBootstrap', () => ({ verifyBootstrap: vi.fn() }));
vi.mock('./runtimeMapsLoader', () => ({ registerProdRuntimeMapsProvider: vi.fn() }));
vi.mock('./argv', () => ({ getParsedPort: vi.fn() }));

import { listenLuckyStackServer } from './createServer';

//? Minimal fake mirroring the bits of http.Server the listen path uses.
class FakeHttpServer {
  private errorHandlers: ((err: NodeJS.ErrnoException) => void)[] = [];
  public listenCalls: { port: number; ip: string }[] = [];
  //? Configure how each `.listen()` resolves: 'success' fires the callback;
  //? an error code emits to the registered `'error'` handler.
  public mode: 'success' | NodeJS.ErrnoException['code'] = 'success';
  //? When set, the Nth listen attempt (0-based) succeeds; earlier ones EADDRINUSE.
  public succeedOnAttempt: number | null = null;
  private attempt = 0;

  once(event: string, handler: (err: NodeJS.ErrnoException) => void): this {
    if (event === 'error') this.errorHandlers.push(handler);
    return this;
  }

  off(event: string, handler: (err: NodeJS.ErrnoException) => void): this {
    if (event === 'error') this.errorHandlers = this.errorHandlers.filter((h) => h !== handler);
    return this;
  }

  listen(port: number, ip: string, cb: () => void): this {
    this.listenCalls.push({ port, ip });
    const current = this.attempt;
    this.attempt += 1;
    queueMicrotask(() => {
      const shouldSucceed = this.succeedOnAttempt !== null
        ? current >= this.succeedOnAttempt
        : this.mode === 'success';
      if (shouldSucceed) {
        cb();
      } else {
        const code = this.succeedOnAttempt !== null ? 'EADDRINUSE' : this.mode;
        const err = Object.assign(new Error(`listen ${String(code)}`), { code }) as NodeJS.ErrnoException;
        //? `once` semantics: each registered error handler fires at most once
        //? and is removed before invocation (mirrors http.Server.once).
        const handlers = this.errorHandlers;
        this.errorHandlers = [];
        for (const h of handlers) h(err);
      }
    });
    return this;
  }
}

const asServer = (f: FakeHttpServer): HttpServer => f as unknown as HttpServer;

beforeEach(() => {
  loggerMock.info.mockReset();
  loggerMock.warn.mockReset();
  loggerMock.error.mockReset();
  registerBindAddressMock.mockReset();
  coreState.isProduction = true;
  coreState.oauthCallbackBase = '';
  delete process.env.SERVER_PORT_AUTO_INCREMENT;
});

afterEach(() => {
  delete process.env.SERVER_PORT_AUTO_INCREMENT;
});

describe('listenLuckyStackServer — success', () => {
  it('binds, resolves with the server, runs the callback, logs success', async () => {
    const fake = new FakeHttpServer();
    const cb = vi.fn();
    const result = await listenLuckyStackServer(asServer(fake), '127.0.0.1', 8080, cb);
    expect(result).toBe(fake);
    expect(fake.listenCalls).toEqual([{ port: 8080, ip: '127.0.0.1' }]);
    expect(cb).toHaveBeenCalledOnce();
    expect(loggerMock.info).toHaveBeenCalledWith('Server is running on http://127.0.0.1:8080/');
  });

  it('parses a string port to a number before binding', async () => {
    const fake = new FakeHttpServer();
    await listenLuckyStackServer(asServer(fake), '0.0.0.0', '3000');
    expect(fake.listenCalls).toEqual([{ port: 3000, ip: '0.0.0.0' }]);
  });
});

describe('listenLuckyStackServer — EADDRINUSE without auto-increment (prod default)', () => {
  it('rejects, logs the actionable error, and does NOT log a success line', async () => {
    //? isProduction=true (set in beforeEach) → auto-increment defaults OFF, so an
    //? in-use port rejects rather than hopping to the next one.
    const fake = new FakeHttpServer();
    fake.mode = 'EADDRINUSE';
    await expect(listenLuckyStackServer(asServer(fake), '127.0.0.1', 8080)).rejects.toMatchObject({ code: 'EADDRINUSE' });
    expect(loggerMock.error).toHaveBeenCalledOnce();
    expect(loggerMock.info).not.toHaveBeenCalled();
    expect(fake.listenCalls).toHaveLength(1);
  });

  it('still rejects in dev when SERVER_PORT_AUTO_INCREMENT is explicitly 0', async () => {
    coreState.isProduction = false;
    process.env.SERVER_PORT_AUTO_INCREMENT = '0';
    const fake = new FakeHttpServer();
    fake.mode = 'EADDRINUSE';
    await expect(listenLuckyStackServer(asServer(fake), '127.0.0.1', 8080)).rejects.toMatchObject({ code: 'EADDRINUSE' });
    expect(fake.listenCalls).toHaveLength(1);
  });
});

describe('listenLuckyStackServer — EADDRINUSE in dev (auto-increment on by default)', () => {
  it('retries to the next free port with NO env flag when not in production', async () => {
    coreState.isProduction = false;
    const fake = new FakeHttpServer();
    fake.succeedOnAttempt = 1; // first port busy, second free
    const result = await listenLuckyStackServer(asServer(fake), '127.0.0.1', 8080);
    expect(result).toBe(fake);
    expect(fake.listenCalls.map((c) => c.port)).toEqual([8080, 8081]);
    expect(loggerMock.warn).toHaveBeenCalledTimes(1);
    expect(loggerMock.info).toHaveBeenCalledWith('Server is running on http://127.0.0.1:8081/');
  });
});

describe('listenLuckyStackServer — EADDRINUSE with auto-increment', () => {
  it('retries the next port and resolves once a port is free', async () => {
    process.env.SERVER_PORT_AUTO_INCREMENT = '1';
    const fake = new FakeHttpServer();
    fake.succeedOnAttempt = 2; // first two ports busy, third free
    const result = await listenLuckyStackServer(asServer(fake), '127.0.0.1', 8080);
    expect(result).toBe(fake);
    expect(fake.listenCalls.map((c) => c.port)).toEqual([8080, 8081, 8082]);
    expect(loggerMock.warn).toHaveBeenCalledTimes(2);
    expect(loggerMock.info).toHaveBeenCalledWith('Server is running on http://127.0.0.1:8082/');
  });
});

describe('listenLuckyStackServer — bind registry truth-up + OAuth drift (Fix 1 + Fix 3)', () => {
  it('re-registers the ACTUALLY-bound port after an auto-increment hop', async () => {
    coreState.isProduction = false;
    const fake = new FakeHttpServer();
    fake.succeedOnAttempt = 1; // 8080 busy, bind 8081
    await listenLuckyStackServer(asServer(fake), '127.0.0.1', 8080);
    //? getBindAddress() readers (checkOrigin's CORS same-origin) must see 8081.
    expect(registerBindAddressMock).toHaveBeenLastCalledWith({ ip: '127.0.0.1', port: 8081 });
  });

  it('registers the bound port even with NO hop (bind == intended)', async () => {
    coreState.isProduction = false;
    const fake = new FakeHttpServer();
    await listenLuckyStackServer(asServer(fake), '127.0.0.1', 8080);
    expect(registerBindAddressMock).toHaveBeenLastCalledWith({ ip: '127.0.0.1', port: 8080 });
  });

  it('warns about OAuth port drift when a hop leaves the callback base pinned to the old port', async () => {
    coreState.isProduction = false;
    coreState.oauthCallbackBase = 'http://localhost:8080';
    const fake = new FakeHttpServer();
    fake.succeedOnAttempt = 1; // hop 8080 -> 8081
    await listenLuckyStackServer(asServer(fake), '127.0.0.1', 8080);
    const driftWarn = loggerMock.warn.mock.calls.find((c) => String(c[0]).includes('OAuth port drift'));
    expect(driftWarn).toBeDefined();
    //? Names BOTH the configured port (:8080) and the live bound port (:8081),
    //? and points at the remaining manual step (provider registration).
    expect(String(driftWarn?.[0])).toContain(':8080');
    expect(String(driftWarn?.[0])).toContain(':8081');
    expect(String(driftWarn?.[0])).toContain('auto-targets');
  });

  it('does NOT warn about drift when the callback base already matches the bound port', async () => {
    coreState.isProduction = false;
    coreState.oauthCallbackBase = 'http://localhost:8081';
    const fake = new FakeHttpServer();
    fake.succeedOnAttempt = 1; // hop 8080 -> 8081, and the base is already 8081
    await listenLuckyStackServer(asServer(fake), '127.0.0.1', 8080);
    const driftWarn = loggerMock.warn.mock.calls.find((c) => String(c[0]).includes('OAuth port drift'));
    expect(driftWarn).toBeUndefined();
  });

  it('does NOT warn about drift when there was no hop at all', async () => {
    coreState.isProduction = false;
    coreState.oauthCallbackBase = 'http://localhost:9999'; // even a mismatch is irrelevant without a hop
    const fake = new FakeHttpServer();
    await listenLuckyStackServer(asServer(fake), '127.0.0.1', 8080);
    const driftWarn = loggerMock.warn.mock.calls.find((c) => String(c[0]).includes('OAuth port drift'));
    expect(driftWarn).toBeUndefined();
  });
});

describe('listenLuckyStackServer — non-EADDRINUSE error', () => {
  it('rejects immediately without retrying or logging the in-use error', async () => {
    const fake = new FakeHttpServer();
    fake.mode = 'EACCES';
    await expect(listenLuckyStackServer(asServer(fake), '127.0.0.1', 80)).rejects.toMatchObject({ code: 'EACCES' });
    expect(loggerMock.error).not.toHaveBeenCalled();
    expect(fake.listenCalls).toHaveLength(1);
  });
});
