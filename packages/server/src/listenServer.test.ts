import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Server as HttpServer } from 'node:http';

//? Characterization tests pinning the behaviour of the `listen` logic
//? extracted out of `createLuckyStackServer` into `listenLuckyStackServer`.
//? They cover: successful bind + resolve + callback, parse of a string port,
//? EADDRINUSE failure path (reject, NO success log), the
//? SERVER_PORT_AUTO_INCREMENT retry path (explicit + dev-default), and
//? non-EADDRINUSE pass-through.
//?
//? `coreState.envKey` is mutable so tests can flip the canonical dev-vs-prod
//? default (`resolveEnvKey`: LUCKYSTACK_ENV before NODE_ENV).
const { loggerMock, coreState, registerBoundAddressMock, writeDevServerInfoMock } = vi.hoisted(() => ({
  loggerMock: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  //? `oauthCallbackBase` is mutable so a test can drive the drift-warning branch.
  coreState: { envKey: 'production', oauthCallbackBase: '' },
  registerBoundAddressMock: vi.fn(),
  writeDevServerInfoMock: vi.fn(),
}));

vi.mock('@luckystack/core', () => ({
  getLogger: () => loggerMock,
  resolveEnvKey: () => coreState.envKey,
  getProjectConfig: () => ({
    logging: { socketStartup: true, devLogs: false },
    oauthCallbackBase: coreState.oauthCallbackBase,
  }),
  registerBindAddress: vi.fn(),
  registerBoundAddress: registerBoundAddressMock,
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
vi.mock('./devServerInfo', () => ({ writeDevServerInfo: writeDevServerInfoMock, clearDevServerInfo: vi.fn() }));

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
  //? Override what node:http reports after success (listen(0) chooses a real port).
  public reportedPort: number | null = null;
  private attempt = 0;
  private boundPort: number | null = null;

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
        this.boundPort = this.reportedPort ?? port;
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

  address(): { address: string; family: string; port: number } | null {
    return this.boundPort === null
      ? null
      : { address: '127.0.0.1', family: 'IPv4', port: this.boundPort };
  }
}

const asServer = (f: FakeHttpServer): HttpServer => f as unknown as HttpServer;

beforeEach(() => {
  loggerMock.info.mockReset();
  loggerMock.warn.mockReset();
  loggerMock.error.mockReset();
  registerBoundAddressMock.mockReset();
  writeDevServerInfoMock.mockReset();
  coreState.envKey = 'production';
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

  it('parses a strict numeric string port before binding', async () => {
    const fake = new FakeHttpServer();
    await listenLuckyStackServer(asServer(fake), '0.0.0.0', '3000');
    expect(fake.listenCalls).toEqual([{ port: 3000, ip: '0.0.0.0' }]);
  });

  it('does not write a dev advertisement in the canonical test environment', async () => {
    coreState.envKey = 'test';
    const fake = new FakeHttpServer();
    await listenLuckyStackServer(asServer(fake), '127.0.0.1', 8080);
    expect(writeDevServerInfoMock).not.toHaveBeenCalled();
  });

  it('registers, advertises, and logs the OS-assigned port after listen(0)', async () => {
    coreState.envKey = 'development';
    const fake = new FakeHttpServer();
    fake.reportedPort = 54_321;

    await listenLuckyStackServer(asServer(fake), '127.0.0.1', 0);

    expect(fake.listenCalls).toEqual([{ port: 0, ip: '127.0.0.1' }]);
    expect(registerBoundAddressMock).toHaveBeenCalledWith({ ip: '127.0.0.1', port: 54_321 });
    expect(writeDevServerInfoMock).toHaveBeenCalledWith('127.0.0.1', 54_321);
    expect(loggerMock.info).toHaveBeenCalledWith('Server is running on http://127.0.0.1:54321/');
  });
});

describe('listenLuckyStackServer — EADDRINUSE without auto-increment (prod default)', () => {
  it('rejects, logs the actionable error, and does NOT log a success line', async () => {
    //? canonical env=production (set in beforeEach) → auto-increment defaults OFF,
    //? so an in-use port rejects rather than hopping to the next one.
    const fake = new FakeHttpServer();
    fake.mode = 'EADDRINUSE';
    await expect(listenLuckyStackServer(asServer(fake), '127.0.0.1', 8080)).rejects.toMatchObject({ code: 'EADDRINUSE' });
    expect(loggerMock.error).toHaveBeenCalledOnce();
    expect(loggerMock.info).not.toHaveBeenCalled();
    expect(fake.listenCalls).toHaveLength(1);
  });

  it('still rejects in dev when SERVER_PORT_AUTO_INCREMENT is explicitly 0', async () => {
    coreState.envKey = 'development';
    process.env.SERVER_PORT_AUTO_INCREMENT = '0';
    const fake = new FakeHttpServer();
    fake.mode = 'EADDRINUSE';
    await expect(listenLuckyStackServer(asServer(fake), '127.0.0.1', 8080)).rejects.toMatchObject({ code: 'EADDRINUSE' });
    expect(fake.listenCalls).toHaveLength(1);
  });
});

describe('listenLuckyStackServer — EADDRINUSE in dev (auto-increment on by default)', () => {
  it('retries to the next free port with NO env flag when the canonical env is development', async () => {
    coreState.envKey = 'development';
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

  it('rejects cleanly instead of retrying beyond TCP port 65535', async () => {
    process.env.SERVER_PORT_AUTO_INCREMENT = '1';
    const fake = new FakeHttpServer();
    fake.mode = 'EADDRINUSE';

    await expect(listenLuckyStackServer(asServer(fake), '127.0.0.1', 65_535))
      .rejects.toThrow(/cannot select a valid higher TCP port/);

    expect(fake.listenCalls.map((call) => call.port)).toEqual([65_535]);
    expect(loggerMock.error).toHaveBeenCalledWith(
      'Port 65535 is already in use and auto-increment cannot select a valid higher TCP port.',
    );
  });
});

describe('listenLuckyStackServer — bind registry truth-up + OAuth drift', () => {
  it('registers the actually-bound port after an auto-increment hop', async () => {
    coreState.envKey = 'development';
    const fake = new FakeHttpServer();
    fake.succeedOnAttempt = 1; // 8080 busy, bind 8081
    await listenLuckyStackServer(asServer(fake), '127.0.0.1', 8080);
    expect(registerBoundAddressMock).toHaveBeenLastCalledWith({ ip: '127.0.0.1', port: 8081 });
  });

  it('registers the bound port even with no hop', async () => {
    coreState.envKey = 'development';
    const fake = new FakeHttpServer();
    await listenLuckyStackServer(asServer(fake), '127.0.0.1', 8080);
    expect(registerBoundAddressMock).toHaveBeenLastCalledWith({ ip: '127.0.0.1', port: 8080 });
  });

  it('warns when a hop leaves the direct callback base on the intended port', async () => {
    coreState.envKey = 'development';
    coreState.oauthCallbackBase = 'http://localhost:8080';
    const fake = new FakeHttpServer();
    fake.succeedOnAttempt = 1;
    await listenLuckyStackServer(asServer(fake), '127.0.0.1', 8080);
    const driftWarn = loggerMock.warn.mock.calls.find((call) => String(call[0]).includes('OAuth port drift'));
    expect(driftWarn).toBeDefined();
    expect(String(driftWarn?.[0])).toContain(':8080');
    expect(String(driftWarn?.[0])).toContain(':8081');
    expect(String(driftWarn?.[0])).toContain('auto-targets');
  });

  it('does not warn when the callback base already matches the bound port', async () => {
    coreState.envKey = 'development';
    coreState.oauthCallbackBase = 'http://localhost:8081';
    const fake = new FakeHttpServer();
    fake.succeedOnAttempt = 1;
    await listenLuckyStackServer(asServer(fake), '127.0.0.1', 8080);
    const driftWarn = loggerMock.warn.mock.calls.find((call) => String(call[0]).includes('OAuth port drift'));
    expect(driftWarn).toBeUndefined();
  });

  it('does not warn when an explicit local router owns a different callback port', async () => {
    coreState.envKey = 'development';
    coreState.oauthCallbackBase = 'http://localhost:4000';
    const fake = new FakeHttpServer();
    fake.succeedOnAttempt = 1;
    await listenLuckyStackServer(asServer(fake), '127.0.0.1', 8080);
    const driftWarn = loggerMock.warn.mock.calls.find((call) => String(call[0]).includes('OAuth port drift'));
    expect(driftWarn).toBeUndefined();
  });

  it('does not warn when there was no hop', async () => {
    coreState.envKey = 'development';
    coreState.oauthCallbackBase = 'http://localhost:9999';
    const fake = new FakeHttpServer();
    await listenLuckyStackServer(asServer(fake), '127.0.0.1', 8080);
    const driftWarn = loggerMock.warn.mock.calls.find((call) => String(call[0]).includes('OAuth port drift'));
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
