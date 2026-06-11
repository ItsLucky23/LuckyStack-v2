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
  }
  const { sendEmail } = await (
    // @ts-expect-error optional peer dep — installed only when the consumer wires email sending
    import('@luckystack/email') as Promise<EmailModule>
  );

  const token = await createEmailChangeToken(userId, newEmail);
  const baseUrl = (config.app.publicUrl || '').replace(/\/+$/, '');
  const confirmUrl = `${baseUrl}/settings/confirm-email?token=${encodeURIComponent(token)}`;
  const ttlMinutes = Math.round(config.auth.emailChangeTtlSeconds / 60);

  //? Dispatch via the built-in `'email-change'` template so consumers can
  //? override the copy with `registerEmailTemplate('email-change', …)` without
  //? forking (CFG-05). Default copy is unchanged.
  const result = await sendEmail({
    to: newEmail,
    template: 'email-change',
    data: { confirmUrl, userName, brand: resolvedBrand, ttlMinutes },
    adapterHint: 'transactional',
  });

  return result.ok ? { ok: true, token } : { ok: false, reason: result.reason, token };
};
