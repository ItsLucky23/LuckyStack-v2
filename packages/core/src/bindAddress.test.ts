import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

//? `resolveEnvKey()` reads LUCKYSTACK_ENV/NODE_ENV. Drive it per test.
const setEnv = (value: string | undefined) => {
  if (value === undefined) delete process.env.LUCKYSTACK_ENV;
  else process.env.LUCKYSTACK_ENV = value;
};

import {
  registerBindAddress,
  registerBoundAddress,
  getBindAddress,
  resolveDevCallbackUrl,
} from './bindAddress';

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

  it('reflects the address node:http reports after binding', () => {
    registerBindAddress({ ip: '127.0.0.1', port: 8080 });
    registerBoundAddress({ ip: '127.0.0.1', port: 8081 });
    expect(getBindAddress()).toEqual({ ip: '127.0.0.1', port: '8081' });
  });
});

describe('resolveDevCallbackUrl — OAuth follows only a direct pre-hop callback', () => {
  const savedEnv = process.env.LUCKYSTACK_ENV;
  const registerHop = (from: number, to: number): void => {
    registerBindAddress({ ip: '127.0.0.1', port: from });
    registerBoundAddress({ ip: '127.0.0.1', port: to });
  };

  beforeEach(() => setEnv('development'));
  afterEach(() => setEnv(savedEnv));

  it('rewrites a localhost callback from the intended port to the bound port', () => {
    registerHop(80, 84);
    expect(resolveDevCallbackUrl('http://localhost:80/auth/callback/google'))
      .toBe('http://localhost:84/auth/callback/google');
  });

  it('rewrites an implicit default port when it was the intended port', () => {
    registerHop(80, 84);
    expect(resolveDevCallbackUrl('http://localhost/auth/callback/github'))
      .toBe('http://localhost:84/auth/callback/github');
  });

  it('rewrites IPv6 loopback with the same policy as localhost CORS', () => {
    registerHop(80, 84);
    expect(resolveDevCallbackUrl('http://[::1]/auth/callback/github'))
      .toBe('http://[::1]:84/auth/callback/github');
  });

  it('preserves an explicit local router or reverse-proxy ingress', () => {
    registerHop(4100, 4101);
    expect(resolveDevCallbackUrl('http://localhost:4000/auth/callback/google'))
      .toBe('http://localhost:4000/auth/callback/google');
  });

  it('is a no-op when the callback port already matches the bound port', () => {
    registerHop(80, 84);
    expect(resolveDevCallbackUrl('http://localhost:84/auth/callback/google'))
      .toBe('http://localhost:84/auth/callback/google');
  });

  it('leaves a non-localhost backend untouched', () => {
    registerHop(80, 84);
    expect(resolveDevCallbackUrl('https://staging.example.com/auth/callback/google'))
      .toBe('https://staging.example.com/auth/callback/google');
  });

  it('is a no-op in production', () => {
    setEnv('production');
    registerHop(80, 84);
    expect(resolveDevCallbackUrl('http://localhost:80/auth/callback/google'))
      .toBe('http://localhost:80/auth/callback/google');
  });

  it('returns an unparseable input unchanged', () => {
    registerHop(80, 84);
    expect(resolveDevCallbackUrl('not-a-url')).toBe('not-a-url');
  });
});
