import { describe, it, expect } from 'vitest';

import { getBuiltInEmailTemplate, listBuiltInEmailTemplates } from './builtInTemplates';

describe('built-in email templates', () => {
  it('lists the shipped built-ins alphabetically', () => {
    expect(listBuiltInEmailTemplates()).toEqual(['email-change', 'password-reset']);
  });

  it('returns undefined for an unknown name', () => {
    expect(getBuiltInEmailTemplate('does-not-exist')).toBeUndefined();
  });

  describe('password-reset', () => {
    const tpl = getBuiltInEmailTemplate('password-reset');

    it('exists', () => {
      expect(tpl).toBeDefined();
    });

    it('builds a branded subject', () => {
      expect(tpl?.subject({ brand: 'Acme' })).toBe('Reset your Acme password');
    });

    it('falls back to the default brand when none supplied', () => {
      expect(tpl?.subject({})).toBe('Reset your LuckyStack password');
    });

    it('renders the reset URL, name, brand and TTL into the body', () => {
      const rendered = tpl?.render({
        resetUrl: 'https://app.example.com/reset-password?token=abc',
        userName: 'Sam',
        brand: 'Acme',
        ttlMinutes: 30,
      });
      expect(rendered?.html).toContain('https://app.example.com/reset-password?token=abc');
      expect(rendered?.html).toContain('Sam');
      expect(rendered?.html).toContain('Acme');
      expect(rendered?.text).toContain('30 minutes');
    });

    it('uses safe fallbacks for missing name/ttl', () => {
      const rendered = tpl?.render({ resetUrl: 'https://x/y' });
      expect(rendered?.html).toContain('Hi there');
      expect(rendered?.text).toContain('60 minutes');
    });
  });

  describe('email-change', () => {
    const tpl = getBuiltInEmailTemplate('email-change');

    it('builds a branded subject', () => {
      expect(tpl?.subject({ brand: 'Acme' })).toBe('Confirm your new Acme email address');
    });

    it('renders the confirm URL into the body', () => {
      const rendered = tpl?.render({
        confirmUrl: 'https://app.example.com/settings/confirm-email?token=xyz',
        userName: 'Sam',
        brand: 'Acme',
        ttlMinutes: 60,
      });
      expect(rendered?.html).toContain('https://app.example.com/settings/confirm-email?token=xyz');
      expect(rendered?.html).toContain('Confirm new email');
    });
  });
});
