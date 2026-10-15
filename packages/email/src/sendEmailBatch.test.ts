import { createHash } from 'node:crypto';

import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearAllHooks,
  registerEmailSender,
  registerErrorTracker,
  registerErrorTrackers,
  registerHook,
  type EmailMessage,
  type EmailResult,
  type EmailSendContext,
  type EmailSender,
} from '@luckystack/core';

import { DEFAULT_EMAIL_CONFIG, registerEmailConfig } from './emailConfig';
import { sendEmail } from './sendEmail';
import { sendEmailBatch } from './sendEmailBatch';
import { registerEmailTemplate, resetEmailTemplatesForTests } from './templates';

interface Sent {
  message: EmailMessage;
  context?: EmailSendContext;
}

//? A sender that records every call and answers per recipient address.
const recordingSender = (answer: (message: EmailMessage) => EmailResult | Promise<EmailResult> = () => ({ ok: true, id: 'id' })) => {
  const sent: Sent[] = [];
  const sender: EmailSender = {
    name: 'recording',
    send: async (message, context) => {
      sent.push({ message, context });
      return answer(message);
    },
  };
  registerEmailSender(sender);
  return sent;
};

const recipients = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ to: `user${String(index)}@example.com`, values: { n: index } }));

const delay = (ms: number) => new Promise((resolve) => { setTimeout(resolve, ms); });

interface TrackerEvent {
  message: string;
  context?: Record<string, unknown>;
}

//? Records what reaches the error tracker (Sentry and friends).
const recordingTracker = (): TrackerEvent[] => {
  const events: TrackerEvent[] = [];
  registerErrorTracker({
    name: 'recording',
    captureException: (error, context) => {
      events.push({ message: error instanceof Error ? error.message : String(error), context });
    },
    captureMessage: () => { /* not used by email */ },
    setUser: () => { /* not used by email */ },
  });
  return events;
};

describe('sendEmailBatch', () => {
  beforeEach(() => {
    clearAllHooks();
    resetEmailTemplatesForTests();
    registerEmailConfig(DEFAULT_EMAIL_CONFIG);
    registerErrorTrackers([]);
  });

  it('renders tokens per recipient and reports every mail as sent, in input order', async () => {
    const sent = recordingSender((message) => ({ ok: true, id: `id-${String(message.to)}` }));

    const result = await sendEmailBatch({
      subject: 'Order {{order}}',
      html: '<p>Hi {{name}}</p>',
      text: 'Hi {{name}}',
      recipients: [
        { to: 'a@example.com', values: { name: '<Ann>', order: 1 } },
        { to: 'b@example.com', values: { name: 'Bob', order: 2 }, subject: 'Own {{order}}' },
      ],
    });

    expect(result).toEqual({
      ok: true,
      items: [
        { index: 0, to: 'a@example.com', ok: true, messageId: 'id-a@example.com', deliveryOutcome: 'sent' },
        { index: 1, to: 'b@example.com', ok: true, messageId: 'id-b@example.com', deliveryOutcome: 'sent' },
      ],
      counts: { total: 2, sent: 2, notSent: 0, unknown: 0 },
    });
    const first = sent.find((entry) => entry.message.to === 'a@example.com')?.message;
    expect(first).toMatchObject({ subject: 'Order 1', html: '<p>Hi &lt;Ann&gt;</p>', text: 'Hi <Ann>' });
    expect(sent.find((entry) => entry.message.to === 'b@example.com')?.message.subject).toBe('Own 2');
  });

  it('keeps the subject plain text and strips a newline coming from a value', async () => {
    const sent = recordingSender();
    await sendEmailBatch({ subject: 'Re: {{v}}', html: 'x', recipients: [{ to: 'a@example.com', values: { v: 'A & B\r\nBcc: x@evil.test' } }] });
    expect(sent[0]?.message.subject).toBe('Re: A & BBcc: x@evil.test');
  });

  it('puts cc/bcc on the first mail only and shared plus own attachments on each', async () => {
    const sent = recordingSender();
    const shared = { filename: 'terms.pdf', content: 'T' };
    const own = { filename: 'invoice.pdf', content: 'I' };
    await sendEmailBatch({
      subject: 's', html: 'h', cc: 'boss@example.com', bcc: ['audit@example.com'], attachments: [shared], concurrency: 1,
      recipients: [{ to: 'a@example.com', attachments: [own] }, { to: 'b@example.com' }],
    });
    expect(sent[0]?.message).toMatchObject({ cc: 'boss@example.com', bcc: ['audit@example.com'], attachments: [shared, own] });
    expect(sent[1]?.message.cc).toBeUndefined();
    expect(sent[1]?.message.bcc).toBeUndefined();
    expect(sent[1]?.message.attachments).toEqual([shared]);
  });

  it('accepts prepared messages, including a registered template', async () => {
    registerEmailTemplate('welcome', { subject: () => 'Welcome', render: () => ({ html: '<p>w</p>', text: 'w' }) });
    const sent = recordingSender();
    const result = await sendEmailBatch({
      messages: [
        { to: 'a@example.com', template: 'welcome' },
        { to: 'b@example.com', subject: 'Raw', html: '<p>r</p>' },
      ],
    });
    expect(result.counts.sent).toBe(2);
    expect(sent.map((entry) => entry.message.subject).toSorted()).toEqual(['Raw', 'Welcome']);
  });

  it('reports a partly failed batch per recipient without throwing', async () => {
    recordingSender((message) => {
      if (message.to === 'user1@example.com') return { ok: false, reason: 'rate limited', deliveryOutcome: 'not-sent' };
      if (message.to === 'user2@example.com') return { ok: false, reason: 'provider 500' };
      if (message.to === 'user3@example.com') throw new Error('socket hang up');
      return { ok: true, id: 'ok' };
    });

    const result = await sendEmailBatch({ subject: 's', html: 'h', recipients: recipients(4) });

    expect(result.ok).toBe(true);
    expect(result.items.map((item) => [item.deliveryOutcome, item.reason])).toEqual([
      ['sent', undefined],
      ['not-sent', 'rate limited'],
      //? No outcome from the adapter: the provider may have accepted it.
      ['unknown', 'provider 500'],
      ['unknown', 'socket hang up'],
    ]);
    expect(result.counts).toEqual({ total: 4, sent: 1, notSent: 1, unknown: 2 });
  });

  it('counts a mail stopped before dispatch (missing template, hook veto) as not-sent', async () => {
    recordingSender();
    registerHook('preEmailSend', (payload) =>
      payload.message.to === 'b@example.com' ? { stop: true, errorCode: 'gdpr.opted-out' } : undefined);

    const result = await sendEmailBatch({
      messages: [{ to: 'a@example.com', template: 'missing' }, { to: 'b@example.com', subject: 's', html: 'h' }],
    });

    expect(result.items.map((item) => [item.reason, item.deliveryOutcome])).toEqual([
      ['no-template', 'not-sent'],
      ['gdpr.opted-out', 'not-sent'],
    ]);
  });

  it('reports a timeout after dispatch as unknown, not as not-sent', async () => {
    registerEmailConfig({ ...DEFAULT_EMAIL_CONFIG, sendTimeoutMs: 20 });
    recordingSender(() => new Promise(() => { /* never answers */ }));
    const result = await sendEmailBatch({ subject: 's', html: 'h', recipients: recipients(1) });
    expect(result.items[0]).toMatchObject({ ok: false, reason: 'send-timeout', deliveryOutcome: 'unknown' });
  });

  it('stops on abort: the mail in flight is unknown, mails not yet started are not-sent', async () => {
    const controller = new AbortController();
    recordingSender(async (message) => {
      if (message.to === 'user1@example.com') controller.abort();
      return { ok: true, id: 'ok' };
    });

    const result = await sendEmailBatch({ subject: 's', html: 'h', recipients: recipients(4), concurrency: 1, signal: controller.signal });

    expect(result.items.map((item) => [item.deliveryOutcome, item.reason])).toEqual([
      ['sent', undefined],
      //? Aborted after it reached the provider: it may still go out.
      ['unknown', 'send-aborted'],
      ['not-sent', 'send-aborted'],
      ['not-sent', 'send-aborted'],
    ]);
  });

  it('never has more mails in flight than the concurrency limit', async () => {
    let inFlight = 0;
    let peak = 0;
    recordingSender(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await delay(5);
      inFlight -= 1;
      return { ok: true, id: 'ok' };
    });

    const result = await sendEmailBatch({ subject: 's', html: 'h', recipients: recipients(9), concurrency: 3 });

    expect(result.counts.sent).toBe(9);
    expect(peak).toBe(3);
  });

  it('spaces mail starts when perSecond is set', async () => {
    const starts: number[] = [];
    recordingSender(() => {
      starts.push(Date.now());
      return { ok: true, id: 'ok' };
    });

    const begin = Date.now();
    await sendEmailBatch({ subject: 's', html: 'h', recipients: recipients(4), concurrency: 4, perSecond: 50 });

    //? Measured from the batch start: a busy machine can only delay a start, so
    //? mail k must not begin before its 20 ms slot (1 ms timer rounding allowed).
    expect(starts).toHaveLength(4);
    for (const [k, start] of starts.toSorted((a, b) => a - b).entries()) {
      expect(start - begin).toBeGreaterThanOrEqual(k * 20 - 1);
    }
  });

  it('derives a stable key per message from the batch key, position and address', async () => {
    const sent = recordingSender();
    const run = () => sendEmailBatch({
      subject: 's', html: 'h', idempotencyKey: 'invoices:2026-10', concurrency: 1,
      recipients: [{ to: 'A@Example.com' }, { to: 'b@example.com', idempotencyKey: 'own-key' }],
    });

    await run();
    await run();

    const expected = createHash('sha256').update('invoices:2026-10:0:a@example.com').digest('hex');
    expect(sent.map((entry) => entry.context?.idempotencyKey)).toEqual([expected, 'own-key', expected, 'own-key']);
  });

  it('sends no key when the batch has none', async () => {
    const sent = recordingSender();
    await sendEmailBatch({ subject: 's', html: 'h', recipients: recipients(1) });
    expect(sent[0]?.context?.idempotencyKey).toBeUndefined();
  });

  it('fires preEmailSend and postEmailSend once per mail', async () => {
    recordingSender();
    const pre: string[] = [];
    const post: string[] = [];
    registerHook('preEmailSend', (payload) => { pre.push(String(payload.message.to)); });
    registerHook('postEmailSend', (payload) => { post.push(String(payload.message.to)); });

    await sendEmailBatch({ subject: 's', html: 'h', recipients: recipients(3) });

    expect(pre.toSorted()).toEqual(['user0@example.com', 'user1@example.com', 'user2@example.com']);
    expect(post.toSorted()).toEqual(pre.toSorted());
  });

  it('refuses an oversized batch, bad options or a bad batch key without sending', async () => {
    const sent = recordingSender();

    const tooLarge = await sendEmailBatch({ subject: 's', html: 'h', recipients: recipients(3), maxMessages: 2 });
    const badOptions = await sendEmailBatch({ subject: 's', html: 'h', recipients: recipients(1), concurrency: 0 });
    const badKey = await sendEmailBatch({ subject: 's', html: 'h', recipients: recipients(1), idempotencyKey: 'a\r\nb' });

    expect(tooLarge).toMatchObject({ ok: false, reason: 'batch-too-large', counts: { total: 3, notSent: 3 } });
    expect(tooLarge.items[0]).toEqual({ index: 0, to: 'user0@example.com', ok: false, reason: 'batch-too-large', deliveryOutcome: 'not-sent' });
    expect(badOptions).toMatchObject({ ok: false, reason: 'invalid-batch-options' });
    expect(badKey).toMatchObject({ ok: false, reason: 'invalid-idempotency-key' });
    expect(sent).toHaveLength(0);
  });

  it('defaults to refusing more than 500 messages', async () => {
    recordingSender();
    const result = await sendEmailBatch({ subject: 's', html: 'h', recipients: recipients(501) });
    expect(result).toMatchObject({ ok: false, reason: 'batch-too-large' });
  });

  describe('error tracker reports', () => {
    it('sends one event per failure reason, with the count, instead of one per recipient', async () => {
      const events = recordingTracker();
      recordingSender(() => ({ ok: false, reason: 'API key is invalid' }));
      registerEmailConfig({ ...DEFAULT_EMAIL_CONFIG, logging: { ...DEFAULT_EMAIL_CONFIG.logging, errors: false } });

      await sendEmailBatch({ subject: 's', html: 'h', recipients: recipients(500) });

      expect(events).toHaveLength(1);
      expect(events[0]?.message).toBe('[email] batch: API key is invalid (500×)');
      expect(events[0]?.context).toMatchObject({ fn: 'sendEmailBatch', count: 500, unknown: 500, notSent: 0, total: 500 });
    });

    it('groups reasons that only differ by the echoed address, and never sends the address', async () => {
      const events = recordingTracker();
      recordingSender((message) => ({ ok: false, reason: `Invalid recipient ${String(message.to)}`, deliveryOutcome: 'not-sent' }));

      await sendEmailBatch({ subject: 's', html: 'h', recipients: recipients(3) });

      expect(events.map((event) => event.message)).toEqual(['[email] batch: Invalid recipient [redacted-email] (3×)']);
      expect(JSON.stringify(events)).not.toContain('@example.com');
    });

    it('counts thrown adapter errors once per reason, not once per mail', async () => {
      const events = recordingTracker();
      recordingSender(() => { throw new Error('socket hang up'); });

      await sendEmailBatch({ subject: 's', html: 'h', recipients: recipients(4) });

      expect(events.map((event) => event.message)).toEqual(['[email] batch: socket hang up (4×)']);
    });

    it('reports a throw from sendEmail itself (required sender missing) once', async () => {
      const events = recordingTracker();
      recordingSender();
      registerEmailConfig({ ...DEFAULT_EMAIL_CONFIG, required: true });

      //? An explicit slot that is not registered throws when a sender is required.
      const result = await sendEmailBatch({ subject: 's', html: 'h', recipients: recipients(2), adapter: 'billing' });

      expect(result.counts).toMatchObject({ total: 2, unknown: 2 });
      expect(events).toHaveLength(1);
      expect(events[0]?.message).toMatch(/\(2×\)$/);
    });

    it('caps distinct reasons at ten events plus one summary', async () => {
      const events = recordingTracker();
      recordingSender((message) => ({ ok: false, reason: `error ${String(message.to).slice(0, 6)}` }));

      await sendEmailBatch({ subject: 's', html: 'h', recipients: recipients(12) });

      expect(events).toHaveLength(11);
      expect(events[10]?.message).toBe('[email] batch: 2 more failure reasons (2×)');
    });

    it('sends nothing to the tracker when every mail succeeds or the caller aborts before start', async () => {
      const events = recordingTracker();
      recordingSender();
      const controller = new AbortController();
      controller.abort();

      await sendEmailBatch({ subject: 's', html: 'h', recipients: recipients(3) });
      await sendEmailBatch({ subject: 's', html: 'h', recipients: recipients(3), signal: controller.signal });

      expect(events).toHaveLength(0);
    });

    it('leaves a single sendEmail reporting its own failure as before', async () => {
      const events = recordingTracker();
      recordingSender(() => ({ ok: false, reason: 'API key is invalid' }));

      await sendEmail({ to: 'a@example.com', subject: 's', html: 'h' });

      expect(events).toHaveLength(1);
      expect(events[0]?.context).toMatchObject({ fn: 'sendEmail', reason: 'API key is invalid' });
    });
  });

  it('returns an empty, successful result for an empty list', async () => {
    const result = await sendEmailBatch({ subject: 's', html: 'h', recipients: [] });
    expect(result).toEqual({ ok: true, items: [], counts: { total: 0, sent: 0, notSent: 0, unknown: 0 } });
  });
});
