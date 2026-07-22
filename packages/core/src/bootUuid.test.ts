import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { setMock, expireMock, loggerMock, deployState } = vi.hoisted(() => ({
  setMock: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  expireMock: vi.fn<(...args: unknown[]) => Promise<number>>(),
  loggerMock: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  deployState: { ttlSeconds: 3600 },
}));

vi.mock('./redis', () => ({
  redis: {
    set: (...args: unknown[]) => setMock(...args),
    expire: (...args: unknown[]) => expireMock(...args),
  },
}));
vi.mock('./deployConfigRegistry', () => ({
  getDeployConfig: () => ({ routing: { bootKeyTtlSeconds: deployState.ttlSeconds } }),
}));
vi.mock('./loggerRegistry', () => ({ getLogger: () => loggerMock }));

import {
  BOOT_KEY_PREFIX,
  refreshBootUuid,
  startBootUuidHeartbeat,
  writeBootUuid,
} from './bootUuid';

const KEY = `${BOOT_KEY_PREFIX}production`;

describe('boot UUID lifecycle', () => {
  beforeEach(() => {
    deployState.ttlSeconds = 3600;
    setMock.mockReset().mockResolvedValue('OK');
    expireMock.mockReset().mockResolvedValue(1);
    loggerMock.error.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('writes a fresh UUID with the configured expiry', async () => {
    const uuid = await writeBootUuid('production');

    expect(uuid).toMatch(/^[0-9a-f-]{36}$/);
    expect(setMock).toHaveBeenCalledWith(KEY, uuid, 'EX', 3600);
  });

  it('renews the existing UUID without rotating its value', async () => {
    await refreshBootUuid('production');

    expect(expireMock).toHaveBeenCalledWith(KEY, 3600);
    expect(setMock).not.toHaveBeenCalled();
  });

  it('recreates the UUID when Redis recovered after the key expired', async () => {
    expireMock.mockResolvedValue(0);

    await refreshBootUuid('production');

    expect(setMock).toHaveBeenCalledOnce();
    expect(setMock).toHaveBeenCalledWith(KEY, expect.stringMatching(/^[0-9a-f-]{36}$/), 'EX', 3600);
  });

  it('refreshes at one third of the TTL without overlapping slow Redis calls', async () => {
    vi.useFakeTimers();
    deployState.ttlSeconds = 3;
    let resolveRefresh: ((value: number) => void) | undefined;
    expireMock.mockImplementation(() => new Promise<number>((resolve) => {
      resolveRefresh = resolve;
    }));

    const heartbeat = startBootUuidHeartbeat('production');
    await vi.advanceTimersByTimeAsync(1000);
    expect(expireMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5000);
    expect(expireMock).toHaveBeenCalledTimes(1);

    resolveRefresh?.(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(expireMock).toHaveBeenCalledTimes(2);
    heartbeat.stop();
  });

  it('stops future refreshes during server shutdown', async () => {
    vi.useFakeTimers();
    deployState.ttlSeconds = 3;
    const heartbeat = startBootUuidHeartbeat('production');

    heartbeat.stop();
    await vi.advanceTimersByTimeAsync(5000);

    expect(expireMock).not.toHaveBeenCalled();
  });

  it('logs a failed refresh and schedules a later retry', async () => {
    vi.useFakeTimers();
    deployState.ttlSeconds = 3;
    expireMock.mockRejectedValueOnce(new Error('redis unavailable')).mockResolvedValue(1);
    const heartbeat = startBootUuidHeartbeat('production');

    await vi.advanceTimersByTimeAsync(1000);
    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.stringContaining('failed to refresh'),
      expect.objectContaining({ message: 'redis unavailable' }),
    );

    await vi.advanceTimersByTimeAsync(1000);
    expect(expireMock).toHaveBeenCalledTimes(2);
    heartbeat.stop();
  });
});
