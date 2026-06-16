import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Server as HttpServer } from 'node:http';

//? Characterization tests pinning the behaviour of the `listen` logic
//? extracted out of `createLuckyStackServer` into `listenLuckyStackServer`.
//? They cover: successful bind + resolve + callback, parse of a string port,
//? EADDRINUSE failure path (reject, NO success log), the
//? SERVER_PORT_AUTO_INCREMENT retry path, and non-EADDRINUSE pass-through.
const { loggerMock } = vi.hoisted(() => ({
  loggerMock: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@luckystack/core', () => ({
  getLogger: () => loggerMock,
  getProjectConfig: () => ({ logging: { socketStartup: true, devLogs: false } }),
  //? Names the module imports at top level but these tests never reach.
  registerBindAddress: vi.fn(),
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

describe('listenLuckyStackServer — EADDRINUSE without auto-increment', () => {
  it('rejects, logs the actionable error, and does NOT log a success line', async () => {
    const fake = new FakeHttpServer();
    fake.mode = 'EADDRINUSE';
    await expect(listenLuckyStackServer(asServer(fake), '127.0.0.1', 8080)).rejects.toMatchObject({ code: 'EADDRINUSE' });
    expect(loggerMock.error).toHaveBeenCalledOnce();
    expect(loggerMock.info).not.toHaveBeenCalled();
    expect(fake.listenCalls).toHaveLength(1);
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

describe('listenLuckyStackServer — non-EADDRINUSE error', () => {
  it('rejects immediately without retrying or logging the in-use error', async () => {
    const fake = new FakeHttpServer();
    fake.mode = 'EACCES';
    await expect(listenLuckyStackServer(asServer(fake), '127.0.0.1', 80)).rejects.toMatchObject({ code: 'EACCES' });
    expect(loggerMock.error).not.toHaveBeenCalled();
    expect(fake.listenCalls).toHaveLength(1);
  });
});
