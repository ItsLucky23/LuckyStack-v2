import { describe, it, expect, beforeEach } from 'vitest';

import { registerEmailSender, type EmailMessage, type EmailSender } from '@luckystack/core';

import { sendEmail } from './sendEmail';
import { registerEmailTemplate, resetEmailTemplatesForTests } from './templates';

//? Proves the template resolution order in sendEmail (CFG-05 / QUA-067):
//?   consumer-registered template → framework built-in → no-template.
//? A capturing stub sender stands in for a real adapter so we can assert the
//? resolved subject/html that reached the wire.

let captured: EmailMessage | null = null;

const captureSender: EmailSender = {
  name: 'capture',
  send: async (message) => {
    captured = message;
    return { ok: true, id: 'test-id' };
  },
};

describe('sendEmail template resolution', () => {
  beforeEach(() => {
    captured = null;
    resetEmailTemplatesForTests();
    registerEmailSender(captureSender);
  });

  it('falls back to the framework built-in when no consumer template is registered', async () => {
    const result = await sendEmail({
      to: 'user@example.com',
      template: 'password-reset',
      data: { resetUrl: 'https://app/reset?token=abc', userName: 'Sam', brand: 'Acme', ttlMinutes: 15 },
    });

    expect(result.ok).toBe(true);
    expect(captured?.subject).toBe('Reset your Acme password');
    expect(captured?.html).toContain('https://app/reset?token=abc');
    expect(captured?.text).toContain('15 minutes');
  });

  it('prefers a consumer-registered override over the built-in (last-write-wins)', async () => {
    registerEmailTemplate('password-reset', {
      subject: () => 'Wachtwoord opnieuw instellen',
      render: () => ({ html: '<p>NL body</p>', text: 'NL body' }),
    });

    await sendEmail({
      to: 'user@example.com',
      template: 'password-reset',
      data: { resetUrl: 'https://app/reset?token=abc' },
    });

    expect(captured?.subject).toBe('Wachtwoord opnieuw instellen');
    expect(captured?.html).toBe('<p>NL body</p>');
  });

  it('resolves the email-change built-in too', async () => {
    await sendEmail({
      to: 'new@example.com',
      template: 'email-change',
      data: { confirmUrl: 'https://app/settings/confirm-email?token=xyz', brand: 'Acme' },
    });

    expect(captured?.subject).toBe('Confirm your new Acme email address');
    expect(captured?.html).toContain('https://app/settings/confirm-email?token=xyz');
  });

  it('returns no-template for an unknown template name with no built-in', async () => {
    const result = await sendEmail({
      to: 'user@example.com',
      template: 'totally-unknown-template',
      data: {},
    });

    expect(result).toEqual({ ok: false, reason: 'no-template' });
    expect(captured).toBeNull();
  });
});
