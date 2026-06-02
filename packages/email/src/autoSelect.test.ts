import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { EmailSender } from '@luckystack/core';

//? `autoSelectEmailSender` reads env vars (names from `getEmailConfig().envVars`)
//? and constructs one of three adapters. We mock the three adapter factories so
//? the test never touches `resend` / `nodemailer` and can assert (a) WHICH
//? adapter was chosen and (b) the exact construction args passed to it. The
//? real `emailConfig` module is used unmocked — it is pure and gives the
//? documented default env-var names.

const consoleFactory = vi.fn((opts?: { from?: string }): EmailSender => ({
  name: 'console',
  send: () => Promise.resolve({ ok: true, id: 'c' }),
  // carry args back for assertion without `any`
  ...({ __opts: opts } as object),
}));
const resendFactory = vi.fn((opts: { apiKey: string; from?: string }): EmailSender => ({
  name: 'resend',
  send: () => Promise.resolve({ ok: true, id: 'r' }),
  ...({ __opts: opts } as object),
}));
const smtpFactory = vi.fn((opts: Record<string, unknown>): EmailSender => ({
  name: 'smtp',
  send: () => Promise.resolve({ ok: true, id: 's' }),
  ...({ __opts: opts } as object),
}));

vi.mock('./adapters/console', () => ({ ConsoleSender: (o?: { from?: string }) => consoleFactory(o) }));
vi.mock('./adapters/resend', () => ({ ResendSender: (o: { apiKey: string; from?: string }) => resendFactory(o) }));
vi.mock('./adapters/smtp', () => ({ SmtpSender: (o: Record<string, unknown>) => smtpFactory(o) }));

import { autoSelectEmailSender } from './autoSelect';
import { registerEmailConfig } from './emailConfig';

//? The env-var keys the default config reads.
const ENV_KEYS = [
  'RESEND_API_KEY',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_SECURE',
  'SMTP_USER',
  'SMTP_PASS',
  'EMAIL_FROM',
] as const;

describe('autoSelectEmailSender', () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    registerEmailConfig({}); // reset to default env-var names + smtpPort default
    consoleFactory.mockClear();
    resendFactory.mockClear();
    smtpFactory.mockClear();
    // Snapshot and clear every env key the selector reads.
    savedEnv = {};
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  describe('env-driven selection order', () => {
    it('falls back to ConsoleSender when no env vars are set', () => {
      const sender = autoSelectEmailSender();
      expect(sender.name).toBe('console');
      expect(consoleFactory).toHaveBeenCalledOnce();
      expect(resendFactory).not.toHaveBeenCalled();
      expect(smtpFactory).not.toHaveBeenCalled();
    });

    it('selects ResendSender when the Resend API key env var is set', () => {
      process.env.RESEND_API_KEY = 'rk_123';
      const sender = autoSelectEmailSender();
      expect(sender.name).toBe('resend');
      expect(resendFactory).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'rk_123' }));
    });

    it('prefers Resend over SMTP when both env vars are present', () => {
      process.env.RESEND_API_KEY = 'rk_123';
      process.env.SMTP_HOST = 'smtp.test';
      const sender = autoSelectEmailSender();
      expect(sender.name).toBe('resend');
      expect(smtpFactory).not.toHaveBeenCalled();
    });

    it('selects SmtpSender when only the SMTP host env var is set', () => {
      process.env.SMTP_HOST = 'smtp.test';
      const sender = autoSelectEmailSender();
      expect(sender.name).toBe('smtp');
      expect(smtpFactory).toHaveBeenCalledOnce();
    });
  });

  describe('SMTP construction details', () => {
    it('parses the SMTP port env var as a number', () => {
      process.env.SMTP_HOST = 'smtp.test';
      process.env.SMTP_PORT = '2525';
      autoSelectEmailSender();
      expect(smtpFactory).toHaveBeenCalledWith(expect.objectContaining({ host: 'smtp.test', port: 2525 }));
    });

    it('uses the configured default SMTP port when the env var is unset', () => {
      process.env.SMTP_HOST = 'smtp.test';
      autoSelectEmailSender();
      expect(smtpFactory).toHaveBeenCalledWith(expect.objectContaining({ port: 587 }));
    });

    it('treats SMTP_SECURE only as secure when it equals the literal string "true"', () => {
      process.env.SMTP_HOST = 'smtp.test';
      process.env.SMTP_SECURE = 'true';
      autoSelectEmailSender();
      expect(smtpFactory).toHaveBeenCalledWith(expect.objectContaining({ secure: true }));
    });

    it('treats any non-"true" SMTP_SECURE value as not secure', () => {
      process.env.SMTP_HOST = 'smtp.test';
      process.env.SMTP_SECURE = '1';
      autoSelectEmailSender();
      expect(smtpFactory).toHaveBeenCalledWith(expect.objectContaining({ secure: false }));
    });

    it('passes auth only when BOTH user and pass env vars are present', () => {
      process.env.SMTP_HOST = 'smtp.test';
      process.env.SMTP_USER = 'u';
      process.env.SMTP_PASS = 'p';
      autoSelectEmailSender();
      expect(smtpFactory).toHaveBeenCalledWith(expect.objectContaining({ auth: { user: 'u', pass: 'p' } }));
    });

    it('omits auth when only the user env var is present', () => {
      process.env.SMTP_HOST = 'smtp.test';
      process.env.SMTP_USER = 'u';
      autoSelectEmailSender();
      expect(smtpFactory).toHaveBeenCalledWith(expect.objectContaining({ auth: undefined }));
    });
  });

  describe('from-address resolution', () => {
    it('passes the explicit `from` option through to the selected adapter', () => {
      process.env.RESEND_API_KEY = 'rk_123';
      autoSelectEmailSender({ from: 'opt@test.dev' });
      expect(resendFactory).toHaveBeenCalledWith(expect.objectContaining({ from: 'opt@test.dev' }));
    });

    it('falls back to the EMAIL_FROM env var when no `from` option is given', () => {
      process.env.RESEND_API_KEY = 'rk_123';
      process.env.EMAIL_FROM = 'env@test.dev';
      autoSelectEmailSender();
      expect(resendFactory).toHaveBeenCalledWith(expect.objectContaining({ from: 'env@test.dev' }));
    });

    it('prefers the explicit `from` option over the EMAIL_FROM env var', () => {
      process.env.RESEND_API_KEY = 'rk_123';
      process.env.EMAIL_FROM = 'env@test.dev';
      autoSelectEmailSender({ from: 'opt@test.dev' });
      expect(resendFactory).toHaveBeenCalledWith(expect.objectContaining({ from: 'opt@test.dev' }));
    });
  });

  describe('forced adapter selection', () => {
    it('force=console returns ConsoleSender even when Resend env is set', () => {
      process.env.RESEND_API_KEY = 'rk_123';
      const sender = autoSelectEmailSender({ force: 'console' });
      expect(sender.name).toBe('console');
      expect(resendFactory).not.toHaveBeenCalled();
    });

    it('force=resend returns ResendSender when the key is present', () => {
      process.env.RESEND_API_KEY = 'rk_123';
      const sender = autoSelectEmailSender({ force: 'resend' });
      expect(sender.name).toBe('resend');
    });

    it('force=resend throws a descriptive error when the key env var is missing', () => {
      expect(() => autoSelectEmailSender({ force: 'resend' })).toThrow(/force=resend requires the RESEND_API_KEY/);
    });

    it('force=smtp returns SmtpSender when the host is present', () => {
      process.env.SMTP_HOST = 'smtp.test';
      const sender = autoSelectEmailSender({ force: 'smtp' });
      expect(sender.name).toBe('smtp');
    });

    it('force=smtp throws a descriptive error when the host env var is missing', () => {
      expect(() => autoSelectEmailSender({ force: 'smtp' })).toThrow(/force=smtp requires the SMTP_HOST/);
    });
  });

  describe('renamed env vars via registerEmailConfig', () => {
    let savedCustom: string | undefined;

    beforeEach(() => {
      savedCustom = process.env.MY_APP_RESEND;
      delete process.env.MY_APP_RESEND;
    });

    afterEach(() => {
      if (savedCustom === undefined) delete process.env.MY_APP_RESEND;
      else process.env.MY_APP_RESEND = savedCustom;
    });

    it('reads the Resend key from the renamed env var', () => {
      registerEmailConfig({ envVars: { resendApiKey: 'MY_APP_RESEND' } });
      process.env.MY_APP_RESEND = 'rk_custom';
      // The default RESEND_API_KEY is cleared by the outer beforeEach, so a hit
      // here proves the rename took effect.
      const sender = autoSelectEmailSender();
      expect(sender.name).toBe('resend');
      expect(resendFactory).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'rk_custom' }));
    });
  });
});
