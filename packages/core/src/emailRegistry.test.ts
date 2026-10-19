import { afterEach, describe, expect, it } from 'vitest';

import {
  getEmailSender,
  getEmailSenderByName,
  listEmailSenderNames,
  registerEmailSender,
  registerEmailSenders,
  type EmailSender,
} from './emailRegistry';

const sender = (name: string): EmailSender => ({
  name,
  send: () => Promise.resolve({ ok: true }),
});

describe('registerEmailSenders', () => {
  afterEach(() => {
    registerEmailSenders({});
  });

  it('drops an earlier single-sender registration when the new registry has no default slot', () => {
    registerEmailSender(sender('console-autoselected'));
    registerEmailSenders({ transactional: sender('smtp'), marketing: sender('resend') });

    expect(getEmailSenderByName('default')).toBeNull();
    expect(getEmailSender()).toBeNull();
    expect(listEmailSenderNames()).toEqual(['transactional', 'marketing']);
    expect(getEmailSenderByName('transactional')?.name).toBe('smtp');
  });

  it('uses the new default slot for both lookups', () => {
    registerEmailSender(sender('console-autoselected'));
    registerEmailSenders({ default: sender('smtp') });

    expect(getEmailSenderByName('default')?.name).toBe('smtp');
    expect(getEmailSender()?.name).toBe('smtp');
  });

  it('keeps the single-sender registration visible as the default slot', () => {
    registerEmailSenders({ marketing: sender('resend') });
    registerEmailSender(sender('smtp'));

    expect(getEmailSenderByName('default')?.name).toBe('smtp');
    expect(getEmailSenderByName('marketing')?.name).toBe('resend');
  });
});
