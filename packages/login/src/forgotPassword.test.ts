import { describe, it, expect, vi, beforeEach } from 'vitest';

//? Findings 038 (timing oracle) and 083 (ignored `auth.passwordResetPath`).
//? `sendPasswordResetEmail` must answer an existing account exactly like an
//? unknown one: no waiting on token creation / the provider send, no distinct
//? failure result. The reset link must use the configured reset path.

const { configMock, sendEmailMock, createTokenMock, findByEmailMock, logger } = vi.hoisted(() => ({
  configMock: vi.fn(),
  sendEmailMock: vi.fn(),
  createTokenMock: vi.fn(async () => 'tok123'),
  findByEmailMock: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@luckystack/core', () => ({
  getProjectConfig: () => configMock(),
  dispatchHook: vi.fn(async () => ({ stopped: false })),
  getLogger: () => logger,
}));
vi.mock('./emailModuleLoader', () => ({
  loadEmailModule: async () => ({ sendEmail: sendEmailMock }),
}));
vi.mock('./passwordReset', () => ({
  createPasswordResetToken: createTokenMock,
}));
vi.mock('./userAdapter', () => ({
  getUserAdapter: () => ({ findByEmail: findByEmailMock }),
}));

import { sendPasswordResetEmail } from './forgotPassword';

const baseConfig = (authOverrides: Record<string, unknown> = {}) => ({
  app: { publicUrl: 'https://app.test/' },
  auth: {
    forgotPassword: 'framework',
    passwordResetTtlSeconds: 3600,
    passwordResetPath: '/reset-password',
    ...authOverrides,
  },
});

const existingUser = { id: 'u1', email: 'a@b.test', name: 'Ada', provider: 'credentials' };

beforeEach(() => {
  vi.clearAllMocks();
  configMock.mockReturnValue(baseConfig());
  sendEmailMock.mockResolvedValue({ ok: true });
});

describe('sendPasswordResetEmail — anti-enumeration (038)', () => {
  it('returns before the provider send settles for an existing account', async () => {
    findByEmailMock.mockResolvedValue(existingUser);
    //? A send that never settles: the old code awaited it, so the call hung.
    sendEmailMock.mockReturnValue(new Promise(() => {}));
    const pending = sendPasswordResetEmail({ email: 'a@b.test' });
    const winner = await Promise.race([
      pending,
      new Promise((resolve) => { setTimeout(() => { resolve('still-waiting'); }, 50); }),
    ]);
    expect(winner).toEqual({ ok: true });
    await vi.waitFor(() => { expect(sendEmailMock).toHaveBeenCalledTimes(1); });
  });

  it('answers a failed send exactly like an unknown address', async () => {
    findByEmailMock.mockResolvedValue(existingUser);
    sendEmailMock.mockResolvedValue({ ok: false, reason: 'smtp-down' });
    expect(await sendPasswordResetEmail({ email: 'a@b.test' })).toEqual({ ok: true });

    findByEmailMock.mockResolvedValue(null);
    expect(await sendPasswordResetEmail({ email: 'nobody@b.test' })).toEqual({ ok: true });
  });

  it('a throwing sender (required, none registered) is logged, not returned as an error', async () => {
    findByEmailMock.mockResolvedValue(existingUser);
    sendEmailMock.mockRejectedValue(new Error('no email sender registered'));
    expect(await sendPasswordResetEmail({ email: 'a@b.test' })).toEqual({ ok: true });
    await vi.waitFor(() => {
      expect(logger.error).toHaveBeenCalledWith(
        '[forgotPassword] reset email delivery failed',
        expect.objectContaining({ userId: 'u1' }),
      );
    });
  });

  it('sends nothing for an unknown address', async () => {
    findByEmailMock.mockResolvedValue(null);
    expect(await sendPasswordResetEmail({ email: 'nobody@b.test' })).toEqual({ ok: true });
    expect(createTokenMock).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});

describe('sendPasswordResetEmail — reset link path (083)', () => {
  it('builds the link from auth.passwordResetPath', async () => {
    configMock.mockReturnValue(baseConfig({ passwordResetPath: '/account/reset' }));
    findByEmailMock.mockResolvedValue(existingUser);
    await sendPasswordResetEmail({ email: 'a@b.test' });
    await vi.waitFor(() => { expect(sendEmailMock).toHaveBeenCalledTimes(1); });
    const [input] = sendEmailMock.mock.calls[0] as [{ data: { resetUrl: string } }];
    expect(input.data.resetUrl).toBe('https://app.test/account/reset?token=tok123');
  });

  it('falls back to /reset-password when the path is empty', async () => {
    configMock.mockReturnValue(baseConfig({ passwordResetPath: '' }));
    findByEmailMock.mockResolvedValue(existingUser);
    await sendPasswordResetEmail({ email: 'a@b.test' });
    await vi.waitFor(() => { expect(sendEmailMock).toHaveBeenCalledTimes(1); });
    const [input] = sendEmailMock.mock.calls[0] as [{ data: { resetUrl: string } }];
    expect(input.data.resetUrl).toBe('https://app.test/reset-password?token=tok123');
  });
});
