//? Framework-mode forgot-password orchestration. Used only when
//? `ProjectConfig.auth.forgotPassword === 'framework'`. Pulls in
//? `@luckystack/email` lazily so the login package doesn't list it as a
//? hard dep — `'custom'` and `'disabled'` modes never reach this code.

import { getProjectConfig, dispatchHook, getLogger } from '@luckystack/core';

import { loadEmailModule } from './emailModuleLoader';
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
  getLogger().info('[forgotPassword] start', { email, forgotPasswordMode: config.auth.forgotPassword });
  if (config.auth.forgotPassword !== 'framework') {
    getLogger().warn('[forgotPassword] auth.forgotPassword is not "framework" — nothing sent', { mode: config.auth.forgotPassword });
    return { ok: false, reason: 'forgotPassword-not-framework' };
  }

  const resolvedBrand = brand ?? config.auth.passwordResetBrand ?? 'LuckyStack';

  // Lazy import — the email package is an optional peer dep so its types
  // may not be resolvable at the framework's compile time.
  //? Mirror testEmail's robustness: catch a failed dynamic import instead of
  //? throwing (an uncaught throw here would bubble out of the anti-enumeration
  //? wrapper as a generic 500). Surfaces the real reason in the server log.
  const emailModule = await loadEmailModule().catch((error: unknown) => {
    getLogger().warn('[forgotPassword] failed to load @luckystack/email — is it installed?', { error: String(error) });
    return null;
  });
  if (!emailModule) {
    return { ok: false, reason: 'email-module-load-failed' };
  }
  const { sendEmail } = emailModule;

  const userAdapter = getUserAdapter();
  const user = await userAdapter.findByEmail({ email, provider: 'credentials' });
  getLogger().info('[forgotPassword] credentials user lookup', { email, found: Boolean(user), userId: user?.id ?? null });

  // Anti-enumeration: always pretend it succeeded if the email isn't found.
  if (!user) {
    //? The client always gets "success" (anti-enumeration). This server-side
    //? line is the ONLY signal that the address simply isn't a credentials
    //? (email+password) account — by far the most common reason a reset email
    //? never arrives (OAuth-only signups and unknown/typo'd addresses have no
    //? credentials row, so there is nothing to reset).
    getLogger().warn('[forgotPassword] no credentials account for this email — nothing sent. Use the email+password account you registered with.', { email });
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

  //? Dispatch via the `'password-reset'` template rather than building the
  //? email inline. `@luckystack/email` ships a built-in for this name, so the
  //? out-of-the-box copy is unchanged — but a consumer can now
  //? `registerEmailTemplate('password-reset', …)` to translate or rebrand it
  //? without forking this flow (CFG-05). `adapterHint: 'transactional'` routes
  //? through a dedicated transactional sender when one is registered, else the
  //? default sender.
  const result = await sendEmail({
    to: user.email,
    template: 'password-reset',
    data: { resetUrl, userName: user.name, brand: resolvedBrand, ttlMinutes },
    adapterHint: 'transactional',
  });

  if (result.ok) {
    getLogger().info('[forgotPassword] reset email dispatched', { userId: user.id, to: user.email });
  } else {
    getLogger().warn('[forgotPassword] reset email send FAILED', { userId: user.id, reason: result.reason });
  }

  return result.ok ? { ok: true } : { ok: false, reason: result.reason };
};
