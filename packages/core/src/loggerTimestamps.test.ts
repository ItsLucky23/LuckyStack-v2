import { describe, it, expect, vi, afterEach } from 'vitest';
import { getLogger, createDevLogger } from './loggerRegistry';
import { registerProjectConfig } from './projectConfig';

const ISO_PREFIX = /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] /;

describe('logger timestamps (logging.timestamps)', () => {
  afterEach(() => {
    registerProjectConfig({}); // back to defaults (timestamps: true)
    vi.restoreAllMocks();
  });

  it('prefixes an ISO-8601 UTC timestamp by default', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    getLogger().info('Connected to Redis');
    const msg = String(info.mock.calls[0]?.[0] ?? '');
    expect(msg).toMatch(new RegExp(`${ISO_PREFIX.source}Connected to Redis$`));
  });

  it('omits the timestamp when logging.timestamps is false', () => {
    registerProjectConfig({ logging: { timestamps: false } });
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    getLogger().info('plain line');
    expect(info).toHaveBeenCalledWith('plain line');
  });

  it('only prefixes the message — context stays a separate console arg', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    getLogger().warn('careful', { code: 42 });
    const [msg, ctx] = warn.mock.calls[0] ?? [];
    expect(String(msg)).toMatch(ISO_PREFIX);
    expect(ctx).toEqual({ code: 42 });
  });

  it('createDevLogger timestamps the message and preserves the trailing color arg', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    createDevLogger().warn('dev warn');
    const [msg, color] = log.mock.calls[0] ?? [];
    expect(String(msg)).toMatch(new RegExp(`${ISO_PREFIX.source}dev warn$`));
    expect(color).toBe('yellow');
  });
});
