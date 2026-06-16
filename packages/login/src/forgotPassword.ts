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
  //? Log mode but NOT the raw email at start — the email is a PII field.
  getLogger().info('[forgotPassword] start', { forgotPasswordMode: config.auth.forgotPassword });
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
  //? Log found/userId without the raw email — logging email+found together is
  //? an enumeration oracle (any reader of the log can probe the user table).
  getLogger().info('[forgotPassword] credentials user lookup', { found: Boolean(user), userId: user?.id ?? null });

  // Anti-enumeration: always pretend it succeeded if the email isn't found.
  if (!user) {
    //? The client always gets "success" (anti-enumeration). This server-side
    //? line is the ONLY signal that the address simply isn't a credentials
    //? (email+password) account — by far the most common reason a reset email
    //? never arrives (OAuth-only signups and unknown/typo'd addresses have no
    //? credentials row, so there is nothing to reset).
    //? Do NOT include the email here — this line together with the email would
    //? let a log reader determine which addresses have credentials accounts.
    getLogger().warn('[forgotPassword] no credentials account for this email — nothing sent. Use the email+password account you registered with.');
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
  //? ADR — DD-ROOTSRC-O8: the reset token is in the URL query string
  //? (`?token=<hex>`), not in the URL fragment (`#token=<hex>`).
  //? Tradeoff: query strings appear in server access logs and Referer headers
  //? if the user's mail client renders the link via a tracking proxy. Fragment
  //? identifiers (`#`) are never sent to the server and are therefore
  //? invisible to any log / proxy in the chain — they are more private.
  //? Decision: query-string is the standard email-link pattern understood by
  //? every SPA router, and tokens here are one-time + hashed at rest (Redis
  //? holds only `sha256(token)`), so the exposure window is the TTL of a
  //? single-use credential, not a replayable secret. Logging is mitigated
  //? by not logging the full URL at the point of issue (we log `userId`, not
  //? `resetUrl`). A future `auth.tokenLinkMode: 'fragment'` option can be
  //? introduced without touching this file — callers receive the raw token
  //? and can build their own URL.
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
