import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEV_RESTART_MESSAGE_TYPE, isDevRestartMessage, requestDevServerRestart } from './devServerRestart';

const originalSend = process.send;
const originalConnected = Object.getOwnPropertyDescriptor(process, 'connected');

afterEach(() => {
  vi.unstubAllEnvs();
  process.send = originalSend;
  if (originalConnected) Object.defineProperty(process, 'connected', originalConnected);
});

const stubChannel = (send: NonNullable<typeof process.send>): void => {
  process.send = send;
  Object.defineProperty(process, 'connected', { value: true, configurable: true });
};

describe('requestDevServerRestart', () => {
  it('sends a restart message when running under the supervisor', () => {
    vi.stubEnv('LUCKYSTACK_CORE_SUPERVISED', 'true');
    const send = vi.fn(() => true);
    stubChannel(send);

    expect(requestDevServerRestart('/app/src/chat/helpers.ts')).toBe(true);
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]).toContainEqual({ type: DEV_RESTART_MESSAGE_TYPE, reason: '/app/src/chat/helpers.ts' });
  });

  it('reports false without the supervisor, so the caller can warn', () => {
    vi.stubEnv('LUCKYSTACK_CORE_SUPERVISED', '');
    const send = vi.fn(() => true);
    stubChannel(send);

    expect(requestDevServerRestart('x')).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('reports false when there is no IPC channel', () => {
    vi.stubEnv('LUCKYSTACK_CORE_SUPERVISED', 'true');
    process.send = undefined;

    expect(requestDevServerRestart('x')).toBe(false);
  });
});

describe('isDevRestartMessage', () => {
  it('accepts only the restart message shape', () => {
    expect(isDevRestartMessage({ type: DEV_RESTART_MESSAGE_TYPE, reason: 'a' })).toBe(true);
    expect(isDevRestartMessage({ type: DEV_RESTART_MESSAGE_TYPE })).toBe(false);
    expect(isDevRestartMessage({ type: 'other', reason: 'a' })).toBe(false);
    expect(isDevRestartMessage('luckystack:dev-restart')).toBe(false);
    expect(isDevRestartMessage(null)).toBe(false);
  });
});
