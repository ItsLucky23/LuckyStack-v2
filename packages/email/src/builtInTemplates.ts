//? Framework-shipped built-in email templates. These back the password-reset
//? and email-change flows in `@luckystack/login` so that flow dispatches via
//? the template registry (`sendEmail({ template, data })`) rather than building
//? the email inline. That makes the documented override contract real: a
//? consumer can `registerEmailTemplate('password-reset', …)` (last-write-wins)
//? to translate or rebrand the copy WITHOUT forking the login package
//? (CFG-05). When no override is registered, `sendEmail` falls back to the
//? built-in below (the resolution step that templates.ts documents but that
//? previously had no implementation — QUA-067).
//?
//? The built-ins live in a static map (not auto-registered into the main
//? registry) so they resolve regardless of import order — `sendEmail` checks
//? the consumer registry first, then here.

import { renderEmailLayout } from './renderEmailLayout';
import type { EmailTemplate } from './templates';

const DEFAULT_BRAND = 'LuckyStack';

const str = (value: unknown, fallback: string): string =>
  typeof value === 'string' && value.length > 0 ? value : fallback;

const num = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/**
 * Data accepted by the built-in `password-reset` template. A consumer override
 * registered via `registerEmailTemplate('password-reset', …)` may accept any
 * shape; the login package always passes this one.
 */
export interface PasswordResetTemplateData {
  resetUrl: string;
  userName?: string | null;
  brand?: string;
  ttlMinutes?: number;
}

/** Data accepted by the built-in `email-change` template. */
export interface EmailChangeTemplateData {
  confirmUrl: string;
  userName?: string | null;
  brand?: string;
  ttlMinutes?: number;
}

const passwordResetTemplate: EmailTemplate = {
  subject: (data) => `Reset your ${str(data.brand, DEFAULT_BRAND)} password`,
  render: (data) => {
    const brand = str(data.brand, DEFAULT_BRAND);
    const userName = str(data.userName, 'there');
    const resetUrl = str(data.resetUrl, '');
    const ttlMinutes = num(data.ttlMinutes, 60);
    return renderEmailLayout({
      brand,
      title: 'Reset your password',
      intro: `Hi ${userName}, we received a request to reset the password on your ${brand} account. Click the button below to choose a new one. The link expires in ${String(ttlMinutes)} minutes.`,
      ctaLabel: 'Reset password',
      ctaUrl: resetUrl,
      outro: `If you didn't request this, you can safely ignore this email — your password will stay the same. The link: ${resetUrl}`,
      footer: `Sent by ${brand}. If you have questions, reply to this email.`,
    });
  },
};

const emailChangeTemplate: EmailTemplate = {
  subject: (data) => `Confirm your new ${str(data.brand, DEFAULT_BRAND)} email address`,
  render: (data) => {
    const brand = str(data.brand, DEFAULT_BRAND);
    const userName = str(data.userName, 'there');
    const confirmUrl = str(data.confirmUrl, '');
    const ttlMinutes = num(data.ttlMinutes, 60);
    return renderEmailLayout({
      brand,
      title: 'Confirm your new email address',
      intro: `Hi ${userName}, you (or someone using your ${brand} account) asked to change the account email to this address. Click the button below to confirm — the link expires in ${String(ttlMinutes)} minutes. If you confirm, all of your active sessions will be signed out as a security precaution.`,
      ctaLabel: 'Confirm new email',
      ctaUrl: confirmUrl,
      outro: `If you didn't request this, you can safely ignore this email — nothing will change. The link: ${confirmUrl}`,
      footer: `Sent by ${brand}. If you have questions, reply to this email.`,
    });
  },
};

const builtInTemplates: Record<string, EmailTemplate> = {
  'password-reset': passwordResetTemplate,
  'email-change': emailChangeTemplate,
};

/** Resolve a framework built-in template by name, or `undefined` if none. */
export const getBuiltInEmailTemplate = (name: string): EmailTemplate | undefined =>
  builtInTemplates[name];

/** List the names of every framework built-in template (alphabetical). */
export const listBuiltInEmailTemplates = (): string[] => Object.keys(builtInTemplates).toSorted();
