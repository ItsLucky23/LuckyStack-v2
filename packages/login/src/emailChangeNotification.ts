//? Framework-mode "email change confirmation" orchestration. Renders the
//? confirmation email + sends it to the NEW address (proves the user can
//? receive at the new mailbox). Mirrors the lazy-import pattern from
//? `forgotPassword.ts` so `@luckystack/email` stays an optional peer.

import { getProjectConfig } from '@luckystack/core';

import { createEmailChangeToken } from './emailChange';

interface SendEmailChangeArgs {
  userId: string;
  newEmail: string;
  /** Optional display name used in the email greeting (falls back to "there"). */
  userName?: string | null;
  /**
   * App-facing display name used in the email greeting + subject. Falls back
   * to `projectConfig.auth.passwordResetBrand` (the shared brand label), then
   * to `'LuckyStack'` as the absolute fallback.
   */
  brand?: string;
}

/**
 * Mint a one-shot email-change token and send a confirmation email to the
 * NEW address with the tokenized URL. Returns the send result for diagnostics
 * + the token itself (callers can audit-log it through the
 * `postEmailChangeRequested` hook).
 */
export const sendEmailChangeConfirmation = async (
  { userId, newEmail, userName, brand }: SendEmailChangeArgs,
): Promise<{ ok: boolean; reason?: string; token: string }> => {
  const config = getProjectConfig();
  const resolvedBrand = brand ?? config.auth.passwordResetBrand ?? 'LuckyStack';

  // Lazy import — `@luckystack/email` is an optional peer dep.
  interface EmailModule {
    sendEmail: (input: Record<string, unknown>) => Promise<{ ok: boolean; reason?: string }>;
    renderEmailLayout: (input: Record<string, unknown>) => { html: string; text: string };
  }
  const { sendEmail, renderEmailLayout } = await (
    // @ts-expect-error optional peer dep — installed only when the consumer wires email sending
    import('@luckystack/email') as Promise<EmailModule>
  );

  const token = await createEmailChangeToken(userId, newEmail);
  const baseUrl = (config.app.publicUrl || '').replace(/\/+$/, '');
  const confirmUrl = `${baseUrl}/settings/confirm-email?token=${encodeURIComponent(token)}`;
  const ttlMinutes = Math.round(config.auth.emailChangeTtlSeconds / 60);

  const { html, text } = renderEmailLayout({
    brand: resolvedBrand,
    title: 'Confirm your new email address',
    intro: `Hi ${userName ?? 'there'}, you (or someone using your ${resolvedBrand} account) asked to change the account email to this address. Click the button below to confirm — the link expires in ${String(ttlMinutes)} minutes. If you confirm, all of your active sessions will be signed out as a security precaution.`,
    ctaLabel: 'Confirm new email',
    ctaUrl: confirmUrl,
    outro: `If you didn't request this, you can safely ignore this email — nothing will change. The link: ${confirmUrl}`,
    footer: `Sent by ${resolvedBrand}. If you have questions, reply to this email.`,
  });

  const result = await sendEmail({
    to: newEmail,
    subject: `Confirm your new ${resolvedBrand} email address`,
    html,
    text,
    adapterHint: 'transactional',
  });

  return result.ok ? { ok: true, token } : { ok: false, reason: result.reason, token };
};
