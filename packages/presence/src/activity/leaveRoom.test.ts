import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { Socket } from 'socket.io';

//? leaveRoom.ts validates the token and returns the session. The security-
//? relevant behavior (M1/SEC-28): the "no session data" warn — which is
//? default-on in production — must NEVER write the raw session token to the
//? logger (a raw token in a log sink = session hijack until expiry). We assert
//? the logged context carries only a non-reversible fingerprint.

const readSessionMock = vi.fn<(token: string) => Promise<{ id: string } | null>>();
const warnMock = vi.fn<(message: string, context?: Record<string, unknown>) => void>();

vi.mock('@luckystack/core', () => ({
  readSession: (token: string) => readSessionMock(token),
  getLogger: () => ({
    debug: vi.fn(),
    warn: warnMock,
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

import { socketLeaveRoom } from './leaveRoom';

const socketStub = {} as Socket;
const RAW_TOKEN = 'abcdef0123456789-secret-session-token';

describe('socketLeaveRoom', () => {
  beforeEach(() => {
    readSessionMock.mockReset();
    warnMock.mockReset();
  });

  it('returns the session when the token resolves', async () => {
    const session = { id: 'u1' };
    readSessionMock.mockResolvedValue(session);
    const result = await socketLeaveRoom({ token: RAW_TOKEN, socket: socketStub, newPath: null });
    expect(result).toBe(session);
    expect(warnMock).not.toHaveBeenCalled();
  });

  it('warns and returns null when no token is provided', async () => {
    const result = await socketLeaveRoom({ token: null, socket: socketStub, newPath: null });
    expect(result).toBeNull();
    expect(readSessionMock).not.toHaveBeenCalled();
  });

  //? M1/SEC-28 — the "no session data" warn must not leak the raw token.
  it('never logs the raw session token on a missing session (M1/SEC-28)', async () => {
    readSessionMock.mockResolvedValue(null);
    const result = await socketLeaveRoom({ token: RAW_TOKEN, socket: socketStub, newPath: null });
    expect(result).toBeNull();
    expect(warnMock).toHaveBeenCalledOnce();

    const context = warnMock.mock.calls[0]?.[1];
    //? Raw token must be absent from the logged context entirely.
    expect(JSON.stringify(context)).not.toContain(RAW_TOKEN);
    //? Only a truncated fingerprint is logged.
    expect(context).toEqual({ tokenFingerprint: `${RAW_TOKEN.slice(0, 8)}…` });
  });
});
