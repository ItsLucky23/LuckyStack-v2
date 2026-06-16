import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  registerEmailSender,
  registerHook,
  clearAllHooks,
  type EmailMessage,
  type EmailSender,
} from '@luckystack/core';

import { sendEmail } from './sendEmail';
import { registerEmailConfig, DEFAULT_EMAIL_CONFIG } from './emailConfig';
import { resetEmailTemplatesForTests } from './templates';

//? Characterization tests pinning the orchestration paths of `sendEmail` after
//? the E13 decomposition (buildMessage / normalizeSendResult / reportSendOutcome
//? extracted, sendEmail kept as a thin orchestrator). These assert the exact
//? observable effects — returned result shape, pre/post hook payloads, and the
//? raw-input message build — so the extraction stays behavior-equivalent.

const okSender = (id = 'sent-id'): EmailSender => ({
  name: 'capture',
  send: async () => ({ ok: true, id }),
});

describe('sendEmail orchestration (post-E13 decomposition)', () => {
  beforeEach(() => {
    clearAllHooks();
    resetEmailTemplatesForTests();
    registerEmailConfig(DEFAULT_EMAIL_CONFIG);
  });

  it('builds a raw-input message and fires pre/post hooks with the same message reference', async () => {
    const holder: { captured: EmailMessage | null } = { captured: null };
    const sender: EmailSender = {
      name: 'capture',
      send: async (message) => {
        holder.captured = message;
        return { ok: true, id: 'raw-id' };
      },
    };
    registerEmailSender(sender);

    const pre: EmailMessage[] = [];
    const post: { message: EmailMessage; ok: boolean; messageId?: string }[] = [];
    registerHook('preEmailSend', (p) => { pre.push(p.message); });
    registerHook('postEmailSend', (p) => { post.push({ message: p.message, ok: p.ok, messageId: p.messageId }); });

    const result = await sendEmail({
      to: 'user@example.com',
      subject: 'Raw subject',
      html: '<p>raw</p>',
      text: 'raw',
      replyTo: 'reply@example.com',
    });

    expect(result).toEqual({ ok: true, id: 'raw-id' });
    expect(holder.captured).toMatchObject({
      to: 'user@example.com',
      subject: 'Raw subject',
      html: '<p>raw</p>',
      text: 'raw',
      replyTo: 'reply@example.com',
      from: DEFAULT_EMAIL_CONFIG.from,
    });
    // pre + post both observed the SAME object reference that reached the sender.
    expect(pre[0]).toBe(holder.captured);
    expect(post[0]?.message).toBe(holder.captured);
    expect(post[0]).toMatchObject({ ok: true, messageId: 'raw-id' });
  });

  it('defaults from to config.from but lets an explicit message.from win', async () => {
    const holder: { captured: EmailMessage | null } = { captured: null };
    registerEmailSender({
      name: 'capture',
      send: async (m) => { holder.captured = m; return { ok: true, id: 'x' }; },
    });

    await sendEmail({ to: 'u@example.com', subject: 'S', html: '<p>x</p>', from: 'override@example.com' });
    expect(holder.captured?.from).toBe('override@example.com');
  });

  it('normalizes a thrown send into ok:false with the error message + cause', async () => {
    const boom = new Error('provider exploded');
    registerEmailSender({ name: 'capture', send: async () => { throw boom; } });

    const post: { ok: boolean; reason?: string }[] = [];
    registerHook('postEmailSend', (p) => { post.push({ ok: p.ok, reason: p.reason }); });

    const result = await sendEmail({ to: 'u@example.com', subject: 'S', html: '<p>x</p>' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('provider exploded');
      expect(result.cause).toBe(boom);
    }
    // post hook sees the normalized failure reason.
    expect(post[0]).toEqual({ ok: false, reason: 'provider exploded' });
  });

  it('uses send-threw when the thrown error has an empty message', async () => {
    registerEmailSender({ name: 'capture', send: async () => { throw new Error(''); } });
    const result = await sendEmail({ to: 'u@example.com', subject: 'S', html: '<p>x</p>' });
    if (!result.ok) expect(result.reason).toBe('send-threw');
  });

  it('forwards a successful adapter result unchanged', async () => {
    registerEmailSender(okSender('provider-123'));
    const result = await sendEmail({ to: 'u@example.com', subject: 'S', html: '<p>x</p>' });
    expect(result).toEqual({ ok: true, id: 'provider-123' });
  });

  it('honors a preEmailSend stop signal: skips the send + postEmailSend and returns the signal errorCode', async () => {
    let sent = false;
    registerEmailSender({ name: 'capture', send: async () => { sent = true; return { ok: true, id: 'should-not-send' }; } });

    registerHook('preEmailSend', () => ({ stop: true, errorCode: 'gdpr.opted-out' }));
    const post: unknown[] = [];
    registerHook('postEmailSend', (p) => { post.push(p); });

    const result = await sendEmail({ to: 'suppressed@example.com', subject: 'S', html: '<p>x</p>' });

    expect(result).toEqual({ ok: false, reason: 'gdpr.opted-out' });
    expect(sent).toBe(false);
    expect(post).toHaveLength(0);
  });
});

// Silence the dev warning logs these paths emit; assertions above don't depend
// on console output.
vi.spyOn(console, 'warn').mockImplementation(() => undefined);
vi.spyOn(console, 'info').mockImplementation(() => undefined);
