import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearAllHooks,
  registerEmailSender,
  registerEmailSenders,
  registerErrorTracker,
  registerErrorTrackers,
  registerHook,
  registerLogger,
  resetLoggerForTests,
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
  /** The attached cause, as text. */
  cause?: unknown;
  context?: Record<string, unknown>;
}

//? Records what reaches the error tracker (Sentry and friends).
const recordingTracker = (): TrackerEvent[] => {
  const events: TrackerEvent[] = [];
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

  it('stops a paced batch promptly on abort instead of waiting out each slot', async () => {
    const controller = new AbortController();
    recordingSender(() => {
      controller.abort();
      return { ok: true, id: 'ok' };
    });

    const begin = Date.now();
    //? 100 ms slots: waiting them out would take seconds.
    const result = await sendEmailBatch({ subject: 's', html: 'h', recipients: recipients(30), concurrency: 2, perSecond: 10, signal: controller.signal });

    expect(Date.now() - begin).toBeLessThan(500);
    expect(result.items.slice(1).map((item) => [item.deliveryOutcome, item.reason])).toEqual(
      Array.from({ length: 29 }, () => ['not-sent', 'send-aborted']),
    );
  });

  it('does not spend pace slots on mails skipped for a blocked sender', async () => {
    const sent = recordingSender(() => ({ ok: false, reason: 'quota', code: 'daily_quota_exceeded', blocksSender: true, deliveryOutcome: 'not-sent' }));

    const begin = Date.now();
    //? 200 ms slots: nine skipped mails each taking a slot would take ~1.8 s.
    const result = await sendEmailBatch({ subject: 's', html: 'h', recipients: recipients(10), concurrency: 1, perSecond: 5 });

    expect(Date.now() - begin).toBeLessThan(500);
    expect(sent).toHaveLength(1);
    expect(result.counts).toMatchObject({ notSent: 10 });
  });

  it('gives a slot reserved by a mail of a sender blocked meanwhile to the next mail', async () => {
    const starts: number[] = [];
    registerEmailSenders({
      default: { name: 'main', send: async () => ({ ok: false, reason: 'quota', code: 'daily_quota_exceeded', blocksSender: true, deliveryOutcome: 'not-sent' }) },
      secondary: {
        name: 'secondary',
        send: async () => {
          starts.push(Date.now());
          return { ok: true, id: 'b' };
        },
      },
    });

    const begin = Date.now();
    //? 100 ms slots. The five waiting mails of the blocked sender used to keep
    //? their slots, so the other sender's mails started at 600 and 700 ms.
    const result = await sendEmailBatch({
      concurrency: 6,
      perSecond: 10,
      messages: [
        ...Array.from({ length: 6 }, (_, index) => ({ to: `a${String(index)}@example.com`, subject: 's', html: 'h' })),
        { to: 'b0@example.com', subject: 's', html: 'h', adapter: 'secondary' },
        { to: 'b1@example.com', subject: 's', html: 'h', adapter: 'secondary' },
      ],
    });

    expect(result.items.map((item) => item.reason ?? item.deliveryOutcome)).toEqual([
      'quota', ...Array.from({ length: 5 }, () => 'sender-blocked'), 'sent', 'sent',
    ]);
    const [first = 0, second = 0] = starts.map((start) => start - begin);
    expect(first).toBeGreaterThanOrEqual(99);
    expect(second - first).toBeGreaterThanOrEqual(99);
    expect(second).toBeLessThan(450);
  });

  describe('derived keys', () => {
    const keysByAddress = (sent: Sent[]) =>
      Object.fromEntries(sent.map((entry) => [String(entry.message.to), entry.context?.idempotencyKey]));
    const invoices = [
      { to: 'a@example.com', values: { amount: 10 } },
      { to: 'b@example.com', values: { amount: 20 } },
      { to: 'c@example.com', values: { amount: 30 } },
    ];
    const run = (recipients: typeof invoices) =>
      sendEmailBatch({ subject: 'Invoice', html: '<p>{{amount}}</p>', idempotencyKey: 'invoices:2026-10', recipients });

    it('keeps every key when the list is reordered or shortened', async () => {
      const first = recordingSender();
      await run(invoices);
      const second = recordingSender();
      await run([invoices[2], invoices[0]].filter((entry) => entry !== undefined));

      const before = keysByAddress(first);
      expect(keysByAddress(second)).toEqual({ 'c@example.com': before['c@example.com'], 'a@example.com': before['a@example.com'] });
      expect(new Set(Object.values(before)).size).toBe(3);
      for (const key of Object.values(before)) expect(key).toMatch(/^[0-9a-f]{64}$/);
    });

    it('changes the key when the content for that address changes, and ignores address case', async () => {
      const first = recordingSender();
      await run(invoices);
      const second = recordingSender();
      await run([{ to: 'A@Example.com', values: { amount: 10 } }, { to: 'b@example.com', values: { amount: 99 } }]);

      expect(keysByAddress(second)['A@Example.com']).toBe(keysByAddress(first)['a@example.com']);
      expect(keysByAddress(second)['b@example.com']).not.toBe(keysByAddress(first)['b@example.com']);
    });

    it('gives two identical mails to one address the same key', async () => {
      const sent = recordingSender();
      await run([invoices[0], invoices[0]].filter((entry) => entry !== undefined));
      expect(sent[0]?.context?.idempotencyKey).toBe(sent[1]?.context?.idempotencyKey);
    });

    it('distinguishes mails that differ only in an attachment', async () => {
      const sent = recordingSender();
      await sendEmailBatch({
        subject: 's', html: 'h', idempotencyKey: 'k',
        recipients: [
          { to: 'a@example.com', attachments: [{ filename: 'invoice.pdf', content: 'one' }] },
          { to: 'a@example.com', attachments: [{ filename: 'invoice.pdf', content: 'two' }] },
        ],
      });
      expect(sent[0]?.context?.idempotencyKey).not.toBe(sent[1]?.context?.idempotencyKey);
    });

    it('distinguishes mails that differ only in sender, copies, a header or an attachment field', async () => {
      const sent = recordingSender();
      const logo = { filename: 'logo.png', href: 'https://cdn.test/a.png', cid: 'logo', contentType: 'image/png' };
      const base = { to: 'a@example.com', subject: 's', html: 'h', attachments: [logo] };
      await sendEmailBatch({
        idempotencyKey: 'k',
        concurrency: 1,
        messages: [
          base,
          { ...base, attachments: [{ ...logo }] },
          { ...base, attachments: [{ ...logo, href: 'https://cdn.test/b.png' }] },
          { ...base, attachments: [{ ...logo, cid: 'other' }] },
          { ...base, attachments: [{ ...logo, contentType: 'image/gif' }] },
          { ...base, headers: { 'X-Campaign': 'one' } },
          { ...base, from: 'billing@example.com' },
          { ...base, replyTo: 'help@example.com' },
          { ...base, cc: 'boss@example.com' },
          { ...base, bcc: ['audit@example.com'] },
        ],
      });
      const [first, identical, ...variants] = sent.map((entry) => entry.context?.idempotencyKey);
      expect(identical).toBe(first);
      expect(new Set([first, ...variants]).size).toBe(variants.length + 1);
    });

    it('keys template messages by template and data, independent of key order', async () => {
      registerEmailTemplate('t', { subject: () => 's', render: () => ({ html: 'h', text: 't' }) });
      const sent = recordingSender();
      await sendEmailBatch({
        idempotencyKey: 'k',
        messages: [
          { to: 'a@example.com', template: 't', data: { x: 1, y: { b: 2, a: 1n } } },
          { to: 'a@example.com', template: 't', data: { y: { a: 1n, b: 2 }, x: 1 } },
          { to: 'a@example.com', template: 't', data: { x: 2 } },
        ],
      });
      const keys = sent.map((entry) => entry.context?.idempotencyKey);
      expect(keys[0]).toBe(keys[1]);
      expect(keys[2]).not.toBe(keys[0]);
    });

    it('tells Map and Set data apart and ignores their insertion order', async () => {
      registerEmailTemplate('t', { subject: () => 's', render: () => ({ html: 'h', text: 't' }) });
      const sent = recordingSender();
      await sendEmailBatch({
        idempotencyKey: 'k',
        messages: [
          { to: 'a@example.com', template: 't', data: { m: new Map([['x', 1], ['y', 2]]) } },
          { to: 'a@example.com', template: 't', data: { m: new Map([['y', 2], ['x', 1]]) } },
          { to: 'a@example.com', template: 't', data: { m: new Map([['x', 9]]) } },
          { to: 'a@example.com', template: 't', data: { m: new Set(['p', 'q']) } },
          { to: 'a@example.com', template: 't', data: { m: new Set(['q', 'p']) } },
          { to: 'a@example.com', template: 't', data: { m: new Set(['r']) } },
          { to: 'a@example.com', template: 't', data: { m: new Map() } },
          { to: 'a@example.com', template: 't', data: { m: {} } },
        ],
      });
      const [map, mapReordered, otherMap, set, setReordered, otherSet, emptyMap, emptyObject] = sent.map((entry) => entry.context?.idempotencyKey);
      expect(mapReordered).toBe(map);
      expect(setReordered).toBe(set);
      expect(new Set([map, otherMap, set, otherSet, emptyMap, emptyObject]).size).toBe(6);
    });

    it('lets a recipient key win over the derived one', async () => {
      const sent = recordingSender();
      await sendEmailBatch({ subject: 's', html: 'h', idempotencyKey: 'k', recipients: [{ to: 'a@example.com', idempotencyKey: 'invoice-123' }] });
      expect(sent[0]?.context?.idempotencyKey).toBe('invoice-123');
    });
  });

  it('generates a plain-text body from the rendered HTML when no text is given', async () => {
    const sent = recordingSender();
    await sendEmailBatch({
      subject: 's', html: '<p>Hi {{name}},</p><p><a href="https://app.test/i/{{id}}">Open</a></p>',
      recipients: [{ to: 'a@example.com', values: { name: '<Ann>', id: 7 } }],
    });
    expect(sent[0]?.message.text).toBe('Hi <Ann>,\n\nOpen (https://app.test/i/7)');
  });

  it('keeps an explicit text body instead of generating one', async () => {
    const sent = recordingSender();
    await sendEmailBatch({ subject: 's', html: '<p>x</p>', text: 'Own {{n}}', recipients: [{ to: 'a@example.com', values: { n: 1 } }] });
    expect(sent[0]?.message.text).toBe('Own 1');
  });

  it('carries the provider code and status on each failed item', async () => {
    recordingSender(() => ({ ok: false, reason: 'Too many requests', code: 'rate_limit_exceeded', status: 429, deliveryOutcome: 'not-sent' }));
    const result = await sendEmailBatch({ subject: 's', html: 'h', recipients: recipients(1) });
    expect(result.items[0]).toMatchObject({ code: 'rate_limit_exceeded', status: 429, deliveryOutcome: 'not-sent' });
  });

  it('skips the rest of a blocked sender’s mails instead of trying each one', async () => {
    const sent = recordingSender(() => ({
      ok: false, reason: 'You have reached your daily quota', code: 'daily_quota_exceeded', status: 429,
      deliveryOutcome: 'not-sent', blocksSender: true,
    }));

    const result = await sendEmailBatch({ subject: 's', html: 'h', recipients: recipients(5), concurrency: 1 });

    expect(sent).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ code: 'daily_quota_exceeded', deliveryOutcome: 'not-sent' });
    expect(result.items.slice(1).map((item) => [item.reason, item.code, item.deliveryOutcome])).toEqual(
      Array.from({ length: 4 }, () => ['sender-blocked', 'daily_quota_exceeded', 'not-sent']),
    );
    expect(result.counts).toMatchObject({ notSent: 5, unknown: 0 });
  });

  it('keeps sending through other senders when one is blocked', async () => {
    registerEmailSenders({
      default: { name: 'main', send: async () => ({ ok: false, reason: 'quota', code: 'daily_quota_exceeded', blocksSender: true, deliveryOutcome: 'not-sent' }) },
      secondary: { name: 'secondary', send: async () => ({ ok: true, id: 'b' }) },
    });

    const result = await sendEmailBatch({
      concurrency: 1,
      messages: [
        { to: 'a@example.com', subject: 's', html: 'h' },
        { to: 'b@example.com', subject: 's', html: 'h' },
        { to: 'c@example.com', subject: 's', html: 'h', adapter: 'secondary' },
      ],
    });

    expect(result.items.map((item) => item.reason ?? item.deliveryOutcome)).toEqual(['quota', 'sender-blocked', 'sent']);
  });

  it('blocks only the failing slot when two slots wrap the same adapter', async () => {
    //? Two Resend accounts: same adapter name, separate quotas.
    registerEmailSenders({
      default: { name: 'resend', send: async () => ({ ok: false, reason: 'quota', code: 'daily_quota_exceeded', blocksSender: true, deliveryOutcome: 'not-sent' }) },
      second_account: { name: 'resend', send: async () => ({ ok: true, id: 'b' }) },
    });

    const result = await sendEmailBatch({
      concurrency: 1,
      messages: [
        { to: 'a@example.com', subject: 's', html: 'h' },
        { to: 'b@example.com', subject: 's', html: 'h' },
        { to: 'c@example.com', subject: 's', html: 'h', adapter: 'second_account' },
        { to: 'd@example.com', subject: 's', html: 'h', adapter: 'second_account' },
      ],
    });

    expect(result.items.map((item) => item.reason ?? item.deliveryOutcome)).toEqual(['quota', 'sender-blocked', 'sent', 'sent']);
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

    it('scrubs the address from the provider error attached to the grouped event', async () => {
      const events = recordingTracker();
      recordingSender((message) => {
        const text = `550 rejected <${String(message.to)}>`;
        return { ok: false, reason: text, cause: new Error(text), deliveryOutcome: 'not-sent' };
      });

      await sendEmailBatch({ subject: 's', html: 'h', recipients: recipients(2) });

      expect(events).toHaveLength(1);
      expect(events[0]?.cause).toBe('550 rejected <[redacted-email]>');
      expect(JSON.stringify(events)).not.toContain('@example.com');
    });

    it('leaves a provider cause of another shape out of the grouped event', async () => {
      const events = recordingTracker();
      recordingSender((message) => ({ ok: false, reason: 'refused', cause: { message: `bad ${String(message.to)}` } }));

      await sendEmailBatch({ subject: 's', html: 'h', recipients: recipients(1) });

      expect(events).toHaveLength(1);
      expect(events[0]?.cause).toBeUndefined();
    });

    it('reports a missing required sender once, as not-sent', async () => {
      const events = recordingTracker();
      const sent = recordingSender();
      registerEmailConfig({ ...DEFAULT_EMAIL_CONFIG, required: true });

      //? A single sendEmail throws for an unregistered slot when a sender is
      //? required; nothing was dispatched, so the batch says not-sent.
      const result = await sendEmailBatch({ subject: 's', html: 'h', recipients: recipients(2), adapter: 'billing' });

      expect(result.counts).toMatchObject({ total: 2, notSent: 2, unknown: 0 });
      expect(result.items.map((item) => item.reason)).toEqual(['no-sender', 'no-sender']);
      expect(sent).toHaveLength(0);
      expect(events.map((event) => event.message)).toEqual(['[email] batch: no-sender (2×)']);
      expect(events[0]?.context).toMatchObject({ notSent: 2, unknown: 0 });
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

    it('groups a throwing hook into one event per reason, without the address', async () => {
      const events = recordingTracker();
      recordingSender();
      registerLogger({ debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined });
      registerHook('preEmailSend', (payload) => { throw new Error(`lookup failed for ${String(payload.message.to)}`); });

      const result = await sendEmailBatch({ subject: 's', html: 'h', recipients: recipients(50) });
      resetLoggerForTests();

      //? Hook errors never stop a mail.
      expect(result.counts.sent).toBe(50);
      expect(events.map((event) => event.message)).toEqual(['[email] batch: preEmailSend hook threw: lookup failed for [redacted-email] (50×)']);
      expect(events[0]?.context).toMatchObject({ count: 50, notSent: 0, unknown: 0 });
      expect(JSON.stringify(events)).not.toContain('@example.com');
    });

    it('scrubs the address from a single send’s hook error report', async () => {
      const events = recordingTracker();
      const logged: unknown[] = [];
      recordingSender();
      registerLogger({ debug: () => undefined, info: () => undefined, warn: () => undefined, error: (message, error) => { logged.push([message, error instanceof Error ? error.message : error]); } });
      registerHook('postEmailSend', (payload) => { throw new Error(`audit failed for ${String(payload.message.to)}`); });

      const result = await sendEmail({ to: 'a@example.com', subject: 's', html: 'h' });
      resetLoggerForTests();

      expect(result.ok).toBe(true);
      expect(events).toEqual([{ message: 'audit failed for [redacted-email]', cause: undefined, context: { hook: 'postEmailSend' } }]);
      expect(logged).toEqual([['hook: handler for "postEmailSend" threw', 'audit failed for [redacted-email]']]);
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
