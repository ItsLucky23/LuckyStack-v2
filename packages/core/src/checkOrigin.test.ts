import { describe, it, expect, vi, beforeEach } from 'vitest';

import allowedOrigin from './checkOrigin';
import { registerProjectConfig } from './projectConfig';
import type { CorsConfig } from './projectConfig';

//? checkOrigin reads cors + devLogs from the real project-config registry
//? (driven here via registerProjectConfig), and reaches into three other
//? seams we mock: the bind address, the logger, and the hook bus. Mocking
//? those lets the test control the same-origin address and assert that the
//? corsRejected hook / dev warning fire.
const getBindAddress = vi.fn<() => { ip: string; port: string }>();
const warn = vi.fn<(message: string, context?: Record<string, unknown>) => void>();
const dispatchHook = vi.fn<(name: string, payload: unknown) => Promise<{ stopped: false }>>();

vi.mock('./bindAddress', () => ({
  getBindAddress: (): { ip: string; port: string } => getBindAddress(),
}));
vi.mock('./loggerRegistry', () => ({
  getLogger: (): {
    warn: typeof warn;
    debug: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  } => ({
    warn,
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  }),
}));
vi.mock('./hooks/registry', () => ({
  dispatchHook: (name: string, payload: unknown): Promise<{ stopped: false }> =>
    dispatchHook(name, payload),
}));

const setCors = (cors: Partial<CorsConfig>, devLogs = false): void => {
  registerProjectConfig({ http: { cors }, logging: { devLogs } });
};

describe('allowedOrigin', () => {
  beforeEach(() => {
    getBindAddress.mockReset();
    warn.mockReset();
    dispatchHook.mockReset();
    dispatchHook.mockResolvedValue({ stopped: false });
    delete process.env.SECURE;
    getBindAddress.mockReturnValue({ ip: '127.0.0.1', port: '3000' });
    registerProjectConfig({});
  });

  it('allows any localhost origin when allowLocalhost is true', () => {
    setCors({ allowLocalhost: true });
    expect(allowedOrigin('http://localhost:5173')).toBe(true);
    expect(dispatchHook).not.toHaveBeenCalled();
  });

  it('does NOT allow localhost when allowLocalhost is false', () => {
    setCors({ allowLocalhost: false });
    expect(allowedOrigin('http://localhost:5173')).toBe(false);
  });

  it('allows an origin present in the static allowlist (exact normalized match)', () => {
    setCors({ allowedOrigins: ['https://app.example.com'] });
    expect(allowedOrigin('https://app.example.com')).toBe(true);
  });

  it('rejects an origin missing from the static allowlist and dispatches corsRejected', () => {
    setCors({ allowedOrigins: ['https://app.example.com'] });
    expect(allowedOrigin('https://evil.example.com')).toBe(false);
    expect(dispatchHook).toHaveBeenCalledTimes(1);
    expect(dispatchHook.mock.calls[0]?.[0]).toBe('corsRejected');
  });

  it('always allows the same-origin bind address', () => {
    setCors({ allowedOrigins: [] });
    getBindAddress.mockReturnValue({ ip: '127.0.0.1', port: '3000' });
    expect(allowedOrigin('http://127.0.0.1:3000')).toBe(true);
  });

  it('normalizes an explicit :80 to the implicit default http port', () => {
    setCors({ allowedOrigins: ['http://example.com'] });
    expect(allowedOrigin('http://example.com:80')).toBe(true);
  });

  it('normalizes an explicit :443 to the implicit default https port', () => {
    setCors({ allowedOrigins: ['https://example.com'] });
    expect(allowedOrigin('https://example.com:443')).toBe(true);
  });

  it('ignores path/query/fragment when comparing origins', () => {
    setCors({ allowedOrigins: ['https://app.example.com'] });
    expect(allowedOrigin('https://app.example.com/some/path?x=1#frag')).toBe(true);
  });

  it('defers to a resolver function when allowedOrigins is a function', () => {
    const resolver = vi.fn((origin: string) => origin === 'https://tenant.example.com');
    setCors({ allowedOrigins: resolver });

    expect(allowedOrigin('https://tenant.example.com')).toBe(true);
    expect(resolver).toHaveBeenCalledWith('https://tenant.example.com');

    expect(allowedOrigin('https://other.example.com')).toBe(false);
  });

  it('allows the same-origin bind address even in resolver mode (resolver not consulted)', () => {
    const resolver = vi.fn(() => false);
    setCors({ allowedOrigins: resolver });
    getBindAddress.mockReturnValue({ ip: '127.0.0.1', port: '3000' });

    expect(allowedOrigin('http://127.0.0.1:3000')).toBe(true);
    expect(resolver).not.toHaveBeenCalled();
  });

  it('logs a warning on rejection only when devLogs is enabled', () => {
    setCors({ allowedOrigins: [] }, true);
    expect(allowedOrigin('https://nope.example.com')).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('does not log a warning on rejection when devLogs is disabled', () => {
    setCors({ allowedOrigins: [] }, false);
    expect(allowedOrigin('https://nope.example.com')).toBe(false);
    expect(warn).not.toHaveBeenCalled();
    // The hook still fires regardless of devLogs.
    expect(dispatchHook).toHaveBeenCalledTimes(1);
  });

  it('rejects an empty origin string', () => {
    setCors({ allowedOrigins: ['https://app.example.com'] });
    expect(allowedOrigin('')).toBe(false);
  });

  it('uses https scheme for bare hostnames when SECURE=true', () => {
    process.env.SECURE = 'true';
    setCors({ allowedOrigins: ['secure.example.com'] });
    // Bare allowlist entry gets https:// prefix; a bare-but-https origin matches.
    expect(allowedOrigin('secure.example.com')).toBe(true);
  });
});
