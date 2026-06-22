//? Per-account brute-force lockout (F7 / MIS-017). The generic per-IP throttle
//? on `/auth/api/credentials` (in @luckystack/server) does NOT stop distributed
//? credential stuffing against a SINGLE account from many IPs. This module adds
//? a per-account failed-attempt counter, keyed independently from the api/ip
//? limits, that locks an account after `rateLimiting.auth.maxAttempts` failures
//? within `rateLimiting.auth.windowMs`.
//?
//? It is OPT-IN: when `rateLimiting.auth.enabled === false` (the default) every
//? function here is a no-op and behaviour is byte-identical to before — only
//? the existing per-IP throttle applies.
//?
//? The counter rides on the framework rate limiter (`checkRateLimit`) so it
//? inherits the configured store (memory/redis) and multi-instance behaviour.
//? `recordAuthFailure` increments; `isAccountLocked` reads WITHOUT incrementing
//? (so merely checking the lock can't itself trip it); `clearAuthFailures`
//? resets the counter on a successful login.

import {
  getProjectConfig,
  checkRateLimit,
  getRateLimitStatus,
  clearRateLimit,
  getLogger,
  registerHook,
} from '@luckystack/core';

//? DD-LOGIN-F5: build the lockout bucket key. When `requesterIp` is supplied
//? the key is an IP+account composite (`auth:<email>:<ip>`) so a remote attacker
//? from one IP cannot lock out an account for legitimate users on different IPs.
//? Without an IP the key is the bare account key (`auth:<email>`) — same
//? behaviour as before. The composite bucket is cleared on success the same way
//? (same key is used in `clearAuthFailures`). Lower-case + trim the account
//? identifier so `Alice@x.com` and `alice@x.com` share one lockout bucket
//? (matches the credentials email normalization).
const lockoutKey = (accountKey: string, requesterIp?: string): string => {
  const base = `auth:${accountKey.trim().toLowerCase()}`;
  return requesterIp ? `${base}:${requesterIp}` : base;
};

/** Read the active auth-lockout config (returns null when the feature is off). */
const getAuthLockoutConfig = (): { maxAttempts: number; windowMs: number } | null => {
  const auth = getProjectConfig().rateLimiting.auth;
  if (!auth.enabled) return null;
  return { maxAttempts: auth.maxAttempts, windowMs: auth.windowMs };
};

/**
 * Whether `accountKey` is currently locked out (failed-attempt counter already
 * at/over the cap). Non-incrementing — safe to call on every login attempt.
 * Always `false` when the feature is disabled.
 * Pass `requesterIp` to check the IP+account composite bucket (DD-LOGIN-F5).
 */
export const isAccountLocked = async (accountKey: string, requesterIp?: string): Promise<boolean> => {
  const cfg = getAuthLockoutConfig();
  if (!cfg || !accountKey) return false;
  const { remaining } = await getRateLimitStatus(lockoutKey(accountKey, requesterIp), cfg.maxAttempts);
  return remaining <= 0;
};

/**
 * Increment the failed-attempt counter for `accountKey`. Call on every failed
 * credentials login for a known/looked-up account. No-op when disabled.
 * Pass `requesterIp` to increment the IP+account composite bucket (DD-LOGIN-F5).
 */
export const recordAuthFailure = async (accountKey: string, requesterIp?: string): Promise<void> => {
  const cfg = getAuthLockoutConfig();
  if (!cfg || !accountKey) return;
  const { allowed, remaining } = await checkRateLimit({
    key: lockoutKey(accountKey, requesterIp),
    limit: cfg.maxAttempts,
    windowMs: cfg.windowMs,
  });
  if (!allowed) {
    getLogger().warn('[authLockout] account temporarily locked after repeated failures', {
      remaining,
      maxAttempts: cfg.maxAttempts,
    });
  }
};

/**
 * Reset the failed-attempt counter for `accountKey` (call after a SUCCESSFUL
 * login so a user who eventually gets their password right isn't penalised by
 * earlier typos). No-op when disabled.
 * Pass `requesterIp` to clear the IP+account composite bucket (DD-LOGIN-F5).
 */
export const clearAuthFailures = async (accountKey: string, requesterIp?: string): Promise<void> => {
  const cfg = getAuthLockoutConfig();
  if (!cfg || !accountKey) return;
  await clearRateLimit(lockoutKey(accountKey, requesterIp));
};

//? ADR 0012 — the lockout counter must reflect GENUINE credential failures only.
//? This is an ALLOW-LIST, not a deny-list: only a real wrong-password attempt
//? (`login.wrongPassword`, covering both the no-account/no-hash dummy-compare
//? path and a failed bcrypt compare) feeds the per-account counter. Everything
//? else is excluded by construction — `preLogin` veto rejections (whose reason
//? is a consumer-controlled `errorCode`), password-POLICY rejections (M-15),
//? input-shape errors, the `login.accountLocked` self-trip, and infra failures
//? (DB find / bcrypt throw, surfaced via `toReasonKey`). A deny-list let any of
//? those — most dangerously a consumer `preLogin` veto an attacker can trigger
//? with just a victim's email and no password — silently drive the lockout and
//? DoS the account. Keep this allow-list narrow.
const COUNTING_REASONS = new Set([
  'login.wrongPassword',
]);

let lockoutHookRegistered = false;

/**
 * Wire the per-account lockout into the `loginFailed` hook (F7). Subscribes once
 * (idempotent) and increments the failed-attempt counter only on a credentials
 * LOGIN failure that carries an email AND is a genuine wrong-password attempt
 * (see `COUNTING_REASONS`). Registration is unconditional (cheap); the recorder
 * itself no-ops when `rateLimiting.auth.enabled` is false, so toggling the
 * config at runtime is honoured without re-wiring.
 */
export const registerAuthLockoutHook = (): void => {
  if (lockoutHookRegistered) return;
  lockoutHookRegistered = true;
  registerHook('loginFailed', async ({ email, provider, reason, stage, requesterIp }) => {
    if (stage !== 'login' || provider !== 'credentials') return;
    if (!email || !COUNTING_REASONS.has(reason)) return;
    //? DD-LOGIN-F5: use the IP+account composite key when an IP was threaded in.
    await recordAuthFailure(email, requesterIp);
  });
};
