import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  registerErrorTracker,
  registerErrorTrackers,
  registerLogger,
  resetLoggerForTests,
} from '@luckystack/core';

import { DEFAULT_EMAIL_CONFIG, registerEmailConfig } from '../emailConfig';
import { sendEmail } from '../sendEmail';
import { sendEmailBatch } from '../sendEmailBatch';

//? `nodemailer` is not installed in this repo (see smtp.test.ts), so the peer
//? loader is replaced with a fake transport. Everything else in core is real,
//? including the tracker and logger registries.
const sendMail = vi.hoisted(() => vi.fn());

vi.mock('@luckystack/core', async (importOriginal) => ({
  ...await importOriginal<typeof import('@luckystack/core')>(),
  loadPeer: () => ({ createTransport: () => ({ sendMail }) }),
}));

const { registerEmailSender } = await import('@luckystack/core');
const { SmtpSender } = await import('./smtp');

describe('SmtpSender failure reporting', () => {
  beforeEach(() => {
    sendMail.mockReset();
    registerErrorTrackers([]);
    registerEmailConfig(DEFAULT_EMAIL_CONFIG);
    registerEmailSender(SmtpSender({ host: 'smtp.test', port: 587, from: 'noreply@acme.test' }));
  });

  afterEach(() => {
    resetLoggerForTests();
  });

  it('leaves reporting to the batch: one grouped tracker event and no address in tracker or log', async () => {
    const events: unknown[] = [];
    registerErrorTracker({
      name: 'recording',
      captureException: (error, context) => {
        const cause = error instanceof Error ? error.cause : undefined;
        events.push({
          message: error instanceof Error ? error.message : String(error),
          cause: cause instanceof Error ? cause.message : cause,
          context,
        });
      },
      captureMessage: () => { /* not used by email */ },
      setUser: () => { /* not used by email */ },
    });
    const warnings: unknown[] = [];
    registerLogger({
      debug: () => { /* not asserted */ },
      info: () => { /* not asserted */ },
      warn: (message, context) => { warnings.push({ message, context }); },
      error: () => { /* not asserted */ },
    });
    sendMail.mockImplementation((payload: { to: string }) =>
      Promise.reject(Object.assign(new Error(`Recipient address rejected: <${payload.to}>`), { responseCode: 550 })));

    const result = await sendEmailBatch({
      subject: 's', html: 'h',
      recipients: [{ to: 'a@example.com' }, { to: 'b@example.com' }, { to: 'c@example.com' }],
    });

    expect(result.items.map((item) => item.status)).toEqual([550, 550, 550]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      message: '[email] batch: Recipient address rejected: <[redacted-email]> (3×)',
      cause: 'Recipient address rejected: <[redacted-email]>',
    });
    expect(warnings.filter((entry) => JSON.stringify(entry).includes('FAILED'))).toHaveLength(3);
    expect(JSON.stringify([events, warnings])).not.toContain('@example.com');
  });

  describe('nodemailer error properties', () => {
    //? Shaped like nodemailer's envelope error: the address is in the message,
    //? the stack and several extra own properties.
    const envelopeError = (to: string) => Object.assign(new Error(`Can't send mail - all recipients were rejected: 550 <${to}>`), {
      name: 'SMTPEnvelopeError',
      code: 'EENVELOPE',
      responseCode: 550,
      command: `RCPT TO:<${to}>`,
      response: `550 <${to}> unknown user`,
      rejected: [to],
      rejectedErrors: [new Error(`550 <${to}>`)],
    });

    //? Everything a tracker SDK could serialise: message, stack and every own
    //? property, of the error and of its cause.
    const dump = (value: unknown): string => {
      if (!(value instanceof Error)) return JSON.stringify(value) ?? '';
      const own = Object.getOwnPropertyNames(value).map((name) => {
        const field: unknown = Reflect.get(value, name);
        return field instanceof Error ? dump(field) : JSON.stringify(field) ?? '';
      });
      return [value.message, value.stack ?? '', ...own].join('\n');
    };

    const rawTracker = (): unknown[] => {
      const errors: unknown[] = [];
      registerErrorTracker({
        name: 'raw',
        captureException: (error, context) => { errors.push(error, context); },
        captureMessage: () => { /* not used by email */ },
        setUser: () => { /* not used by email */ },
      });
      return errors;
    };

    it('a single send reaches the tracker with a fresh, address-free error', async () => {
      const captured = rawTracker();
      sendMail.mockImplementation((payload: { to: string }) => Promise.reject(envelopeError(payload.to)));

      const result = await sendEmail({ to: 'ann@example.com', subject: 's', html: 'h' });

      expect(result).toMatchObject({ ok: false, code: 'EENVELOPE', status: 550 });
      expect(captured).toHaveLength(2);
      const [error, context] = captured;
      expect(error).toMatchObject({ name: 'SMTPEnvelopeError', code: 'EENVELOPE', responseCode: 550 });
      expect(error).not.toHaveProperty('rejected');
      expect(dump(error)).toContain('550 <[redacted-email]>');
      expect(dump(error) + JSON.stringify(context)).not.toContain('@example.com');
    });

    it('a batch attaches the same kind of fresh error to its grouped event', async () => {
      const captured = rawTracker();
      sendMail.mockImplementation((payload: { to: string }) => Promise.reject(envelopeError(payload.to)));

      await sendEmailBatch({ subject: 's', html: 'h', recipients: [{ to: 'a@example.com' }, { to: 'b@example.com' }] });

      expect(captured).toHaveLength(2);
      const [event] = captured;
      const cause: unknown = event instanceof Error ? event.cause : undefined;
      expect(cause).toMatchObject({ name: 'SMTPEnvelopeError', code: 'EENVELOPE', responseCode: 550 });
      expect(cause).not.toHaveProperty('command');
      expect(dump(event) + dump(cause)).not.toContain('@example.com');
    });
  });
});
