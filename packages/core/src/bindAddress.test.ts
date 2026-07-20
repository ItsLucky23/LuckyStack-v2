import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

//? `resolveEnvKey()` reads LUCKYSTACK_ENV/NODE_ENV. Drive it per test.
const setEnv = (value: string | undefined) => {
  if (value === undefined) delete process.env.LUCKYSTACK_ENV;
  else process.env.LUCKYSTACK_ENV = value;
};

import { registerBindAddress, getBindAddress, resolveDevCallbackUrl } from './bindAddress';

describe('bindAddress registry', () => {
  const savedEnv = process.env.LUCKYSTACK_ENV;
  const savedPort = process.env.SERVER_PORT;
  const savedIp = process.env.SERVER_IP;

  beforeEach(() => {
    //? Reset the module-level registry by registering a known value, then the
    //? individual tests overwrite it. There is no public reset, so each test
    //? sets what it needs.
    setEnv('development');
    delete process.env.SERVER_PORT;
    delete process.env.SERVER_IP;
  });

  afterEach(() => {
    setEnv(savedEnv);
    if (savedPort === undefined) delete process.env.SERVER_PORT; else process.env.SERVER_PORT = savedPort;
    if (savedIp === undefined) delete process.env.SERVER_IP; else process.env.SERVER_IP = savedIp;
    vi.restoreAllMocks();
  });

  it('reflects the last registered address', () => {
    registerBindAddress({ ip: '127.0.0.1', port: 8081 });
    expect(getBindAddress()).toEqual({ ip: '127.0.0.1', port: '8081' });
  });
});

describe('resolveDevCallbackUrl — OAuth follows the actually-bound dev port', () => {
  const savedEnv = process.env.LUCKYSTACK_ENV;

  beforeEach(() => setEnv('development'));
  afterEach(() => setEnv(savedEnv));

  it('rewrites a localhost callback port to the bound port after a hop', () => {
    registerBindAddress({ ip: '127.0.0.1', port: 84 });
    expect(resolveDevCallbackUrl('http://localhost:80/auth/callback/google'))
      .toBe('http://localhost:84/auth/callback/google');
  });

  it('rewrites a default-port (no explicit :80) callback base too', () => {
    registerBindAddress({ ip: '127.0.0.1', port: 84 });
    //? `http://localhost/...` has an implicit :80 — it must still hop to :84.
    expect(resolveDevCallbackUrl('http://localhost/auth/callback/github'))
      .toBe('http://localhost:84/auth/callback/github');
  });

  it('collapses the default port to no explicit port when bound == 80', () => {
    registerBindAddress({ ip: '127.0.0.1', port: 80 });
    //? bound :80 is the http default — keep the URL byte-stable (no :80 added),
    //? matching how a provider redirect_uri is normally registered.
    expect(resolveDevCallbackUrl('http://localhost:81/auth/callback/google'))
      .toBe('http://localhost/auth/callback/google');
  });

  it('is a no-op when the callback port already matches the bound port', () => {
    registerBindAddress({ ip: '127.0.0.1', port: 84 });
    expect(resolveDevCallbackUrl('http://localhost:84/auth/callback/google'))
      .toBe('http://localhost:84/auth/callback/google');
  });

  it('leaves a non-localhost (remote dev backend) base untouched', () => {
    registerBindAddress({ ip: '127.0.0.1', port: 84 });
    expect(resolveDevCallbackUrl('https://staging.example.com/auth/callback/google'))
      .toBe('https://staging.example.com/auth/callback/google');
  });

  it('is a no-op in production (no hop; public domain has no port to chase)', () => {
    setEnv('production');
    registerBindAddress({ ip: '127.0.0.1', port: 84 });
    expect(resolveDevCallbackUrl('http://localhost:80/auth/callback/google'))
      .toBe('http://localhost:80/auth/callback/google');
  });

  it('returns an unparseable input unchanged', () => {
    registerBindAddress({ ip: '127.0.0.1', port: 84 });
    expect(resolveDevCallbackUrl('not-a-url')).toBe('not-a-url');
  });
});
