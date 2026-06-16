import { describe, it, expect } from 'vitest';

import type { EmailMessage } from '@luckystack/core';

import { toProviderPayload } from './providerPayload';

//? Tests for the shared SMTP/Resend field mapper (E14). Covers the ten
//? forwarded fields (the original eight + `attachments` + `headers`) and the
//? resolved `from` override.

describe('toProviderPayload', () => {
  it('projects the eight base fields with the resolved from (no attachments or headers in this message)', () => {
    const message: EmailMessage = {
      to: 'user@test.dev',
      subject: 'Hi',
      html: '<p>Hi</p>',
      text: 'Hi',
      from: 'ignored@should-not-win.test',
      replyTo: 'reply@test.dev',
      cc: ['c1@test.dev', 'c2@test.dev'],
      bcc: 'b@test.dev',
    };

    const payload = toProviderPayload(message, 'resolved@acme.test');

    // `from` is whatever the caller resolved, NOT message.from.
    expect(payload).toEqual({
      from: 'resolved@acme.test',
      to: 'user@test.dev',
      subject: 'Hi',
      html: '<p>Hi</p>',
      text: 'Hi',
      replyTo: 'reply@test.dev',
      cc: ['c1@test.dev', 'c2@test.dev'],
      bcc: 'b@test.dev',
    });
    // Exactly the eight base keys — attachments/headers absent when not supplied.
    expect(Object.keys(payload).toSorted()).toEqual(
      ['bcc', 'cc', 'from', 'html', 'replyTo', 'subject', 'text', 'to'],
    );
  });

  it('carries undefined optional fields through as undefined (does not drop the keys)', () => {
    const message: EmailMessage = {
      to: 'user@test.dev',
      subject: 'S',
      html: '<p>x</p>',
    };

    const payload = toProviderPayload(message, 'resolved@acme.test');

    expect(payload.text).toBeUndefined();
    expect(payload.replyTo).toBeUndefined();
    expect(payload.cc).toBeUndefined();
    expect(payload.bcc).toBeUndefined();
  });

  it('forwards attachments and headers when present (EMAIL-O2)', () => {
    const message: EmailMessage = {
      to: 'user@test.dev',
      subject: 'S',
      html: '<p>x</p>',
      attachments: [{ filename: 'a.txt', content: 'x' }],
      headers: { 'X-Entity-Ref-ID': '1' },
    };

    const payload = toProviderPayload(message, 'resolved@acme.test');

    expect(payload.attachments).toEqual([{ filename: 'a.txt', content: 'x' }]);
    expect(payload.headers).toEqual({ 'X-Entity-Ref-ID': '1' });
  });

  it('omits attachments and headers keys when the message has none', () => {
    const message: EmailMessage = {
      to: 'user@test.dev',
      subject: 'S',
      html: '<p>x</p>',
    };

    const payload = toProviderPayload(message, 'resolved@acme.test');

    expect(payload).not.toHaveProperty('attachments');
    expect(payload).not.toHaveProperty('headers');
  });
});
