import { describe, it, expect } from 'vitest';

import type { EmailMessage } from '@luckystack/core';

import { toProviderPayload } from './providerPayload';

//? Characterization tests for the shared SMTP/Resend field mapper (E14). These
//? pin the exact wire shape both adapters used to build inline so the extracted
//? helper stays byte-for-byte equivalent: the same eight fields, the resolved
//? `from`, and NO `attachments`/`headers` projection (neither adapter forwarded
//? those before the extraction).

describe('toProviderPayload', () => {
  it('projects exactly the eight historically-forwarded fields with the resolved from', () => {
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
    // Exactly the eight keys — no more.
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

  it('does NOT forward attachments or headers (behavior preserved from before the extraction)', () => {
    const message: EmailMessage = {
      to: 'user@test.dev',
      subject: 'S',
      html: '<p>x</p>',
      attachments: [{ filename: 'a.txt', content: 'x' }],
      headers: { 'X-Entity-Ref-ID': '1' },
    };

    const payload = toProviderPayload(message, 'resolved@acme.test');

    expect(payload).not.toHaveProperty('attachments');
    expect(payload).not.toHaveProperty('headers');
  });
});
