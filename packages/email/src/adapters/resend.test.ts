import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { EmailMessage } from '@luckystack/core';

//? ResendSender wraps the `resend` SDK. The factory synchronously resolves the
//? real `resend` package on disk (it IS installed in this repo), then lazily
//? `import('resend')` and constructs `new Resend(apiKey)` on first send. We
//? mock the `resend` module so the dynamic import returns a fake client — no
//? network, no real SDK behavior. The `createRequire(...).resolve('resend')`
//? boot guard still hits the real on-disk package (which exists), so it passes.

const sendMock = vi.fn();

class FakeResend {
  emails = { send: sendMock };
  constructor(public apiKey: string) {}
}

vi.mock('resend', () => ({ Resend: FakeResend }));

import { ResendSender } from './resend';

const message: EmailMessage = {
  to: 'user@test.dev',
  subject: 'Hi',
  html: '<p>Hi</p>',
  text: 'Hi',
  from: 'noreply@acme.test',
};

describe('ResendSender', () => {
  beforeEach(() => {
    sendMock.mockReset();
  });

  it('throws when constructed without an apiKey', () => {
    expect(() => ResendSender({ apiKey: '' })).toThrow(/requires `apiKey`/);
  });

  it('constructs with name "resend" without touching the network', () => {
    const sender = ResendSender({ apiKey: 'rk_123' });
    expect(sender.name).toBe('resend');
    // No send call happened during construction — the import is lazy.
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('returns missing-from when neither the message nor the default supplies from', async () => {
    const sender = ResendSender({ apiKey: 'rk_123' });
    const result = await sender.send({ to: 'u@test.dev', subject: 'S', html: '<p>x</p>' });
    expect(result).toEqual({ ok: false, reason: 'missing-from' });
    // Resolution short-circuits before calling the SDK.
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('forwards the message fields to the SDK and returns the provider id on success', async () => {
    sendMock.mockResolvedValue({ data: { id: 'resend-id-1' }, error: null });
    const sender = ResendSender({ apiKey: 'rk_123' });
    const result = await sender.send(message);
    expect(result).toEqual({ ok: true, id: 'resend-id-1' });
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'noreply@acme.test',
        to: 'user@test.dev',
        subject: 'Hi',
        html: '<p>Hi</p>',
        text: 'Hi',
      }),
    );
  });

  it('uses the constructor default `from` when the message omits it', async () => {
    sendMock.mockResolvedValue({ data: { id: 'x' }, error: null });
    const sender = ResendSender({ apiKey: 'rk_123', from: 'default@acme.test' });
    await sender.send({ to: 'u@test.dev', subject: 'S', html: '<p>x</p>' });
    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({ from: 'default@acme.test' }));
  });

  it('returns the provider error message when the SDK reports an error', async () => {
    sendMock.mockResolvedValue({ data: null, error: { message: 'rate limited' } });
    const sender = ResendSender({ apiKey: 'rk_123' });
    const result = await sender.send(message);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('rate limited');
  });

  it('falls back to a generic reason when the provider error has no message', async () => {
    sendMock.mockResolvedValue({ data: null, error: { message: '' } });
    const sender = ResendSender({ apiKey: 'rk_123' });
    const result = await sender.send(message);
    if (!result.ok) expect(result.reason).toBe('resend-error');
  });

  it('returns no-response-data when the SDK reports neither data nor error', async () => {
    sendMock.mockResolvedValue({ data: null, error: null });
    const sender = ResendSender({ apiKey: 'rk_123' });
    const result = await sender.send(message);
    expect(result).toMatchObject({ ok: false, reason: 'no-response-data' });
  });
});
