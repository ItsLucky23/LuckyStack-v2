import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  registerErrorTracker,
  registerErrorTrackers,
  registerLogger,
  resetLoggerForTests,
} from '@luckystack/core';

import { DEFAULT_EMAIL_CONFIG, registerEmailConfig } from '../emailConfig';
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
});
