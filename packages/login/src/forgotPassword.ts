//? Framework-mode forgot-password orchestration. Used only when
//? `ProjectConfig.auth.forgotPassword === 'framework'`. Pulls in
//? `@luckystack/email` lazily so the login package doesn't list it as a
//? hard dep — `'custom'` and `'disabled'` modes never reach this code.

import { getProjectConfig, dispatchHook } from '@luckystack/core';

import { createPasswordResetToken } from './passwordReset';
import { getUserAdapter } from './userAdapter';

interface SendResetEmailArgs {
  email: string;
  /**
   * App-facing display name used in the email greeting + subject. If omitted,
   * falls back to `projectConfig.auth.passwordResetBrand`, then to `'LuckyStack'`
   * as the absolute fallback. Real consumers should set this on either the
   * call site OR via `projectConfig.auth.passwordResetBrand`.
   */
  brand?: string;
}

/**
 * Look up the user by credentials-provider email, generate a reset token,
 * and email them a reset link. Always resolves successfully regardless of
 * whether the email matched a user (anti-enumeration). Returns the result
 * of the email send for diagnostics.
 */
export const sendPasswordResetEmail = async ({ email, brand }: SendResetEmailArgs): Promise<{ ok: boolean; reason?: string }> => {
  const config = getProjectConfig();
  if (config.auth.forgotPassword !== 'framework') {
    return { ok: false, reason: 'forgotPassword-not-framework' };
  }

  const resolvedBrand = brand ?? config.auth.passwordResetBrand ?? 'LuckyStack';

  // Lazy import — the email package is an optional peer dep so its types
  // may not be resolvable at the framework's compile time.
  interface EmailModule {
    sendEmail: (input: Record<string, unknown>) => Promise<{ ok: boolean; reason?: string }>;
    renderEmailLayout: (input: Record<string, unknown>) => { html: string; text: string };
  }
  const { sendEmail, renderEmailLayout } = await (
    // @ts-expect-error optional peer dep — installed only when forgotPassword === 'framework'
    import('@luckystack/email') as Promise<EmailModule>
  );

  const userAdapter = getUserAdapter();
  const user = await userAdapter.findByEmail({ email, provider: 'credentials' });

  // Anti-enumeration: always pretend it succeeded if the email isn't found.
  if (!user) {
    void dispatchHook('passwordResetRequested', {
      email,
      matched: false,
    });
    return { ok: true };
  }

  const token = await createPasswordResetToken(user.id);
  void dispatchHook('passwordResetRequested', {
    email,
    matched: true,
    userId: user.id,
    token,
    ttlSeconds: config.auth.passwordResetTtlSeconds,
  });
  const baseUrl = (config.app.publicUrl || '').replace(/\/+$/, '');
  const resetUrl = `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`;

  const ttlMinutes = Math.round(config.auth.passwordResetTtlSeconds / 60);
  const { html, text } = renderEmailLayout({
    brand: resolvedBrand,
    title: 'Reset your password',
    intro: `Hi ${user.name ?? 'there'}, we received a request to reset the password on your ${resolvedBrand} account. Click the button below to choose a new one. The link expires in ${String(ttlMinutes)} minutes.`,
    ctaLabel: 'Reset password',
    ctaUrl: resetUrl,
    outro: `If you didn't request this, you can safely ignore this email — your password will stay the same. The link: ${resetUrl}`,
    footer: `Sent by ${resolvedBrand}. If you have questions, reply to this email.`,
  });

  //? `adapterHint: 'transactional'` lets consumers who registered separate
  //? marketing + transactional senders via `registerEmailSenders({...})`
  //? route this through the transactional adapter automatically. Falls
  //? back to the default sender when only one is registered.
  const result = await sendEmail({
    to: user.email,
    subject: `Reset your ${resolvedBrand} password`,
    html,
    text,
    adapterHint: 'transactional',
  });

  return result.ok ? { ok: true } : { ok: false, reason: result.reason };
};
