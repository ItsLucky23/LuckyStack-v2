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

//? One-shot guard so the inert-config warning below fires once per process, not
//? on every login attempt.
let warnedLockoutInert = false;

/** Read the active auth-lockout config (returns null when the feature is off). */
const getAuthLockoutConfig = (): { maxAttempts: number; maxAttemptsPerAccount: number; windowMs: number } | null => {
  const rateLimiting = getProjectConfig().rateLimiting;
  if (!rateLimiting.auth.enabled) return null;
  //? The counter rides the framework rate limiter, which short-circuits when the
  //? GLOBAL `rateLimiting.enabled` is false — so `auth.enabled:true` +
  //? `enabled:false` makes recordAuthFailure/isAccountLocked silent no-ops, i.e. a
  //? believed-on-but-INERT brute-force defense. Warn once so the conflict surfaces.
  if (!rateLimiting.enabled && !warnedLockoutInert) {
    warnedLockoutInert = true;
    getLogger().warn(
      '[LuckyStack] rateLimiting.auth.enabled is true but rateLimiting.enabled is false — the per-account brute-force lockout is INERT (it rides the global rate limiter, which is off). Set rateLimiting.enabled to true for the lockout to take effect.',
    );
  }
  return {
    maxAttempts: rateLimiting.auth.maxAttempts,
    maxAttemptsPerAccount: rateLimiting.auth.maxAttemptsPerAccount,
    windowMs: rateLimiting.auth.windowMs,
  };
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
  //? DUAL counter (DD-LOGIN-F5 + the cross-IP fix). Lock if EITHER trips:
  //?  - the bare-account bucket (`auth:<email>`) against the cross-IP cap
  //?    (`maxAttemptsPerAccount`) — the distributed-credential-stuffing defense, and
  //?  - the IP+account composite (`auth:<email>:<ip>`) against the per-IP cap
  //?    (`maxAttempts`) — bounds one IP + shields other IPs from a victim-lock DoS.
  const accountStatus = await getRateLimitStatus(lockoutKey(accountKey), cfg.maxAttemptsPerAccount);
  if (accountStatus.remaining <= 0) return true;
  if (requesterIp) {
    const ipStatus = await getRateLimitStatus(lockoutKey(accountKey, requesterIp), cfg.maxAttempts);
    if (ipStatus.remaining <= 0) return true;
  }
  return false;
};

/**
 * Increment the failed-attempt counter for `accountKey`. Call on every failed
 * credentials login for a known/looked-up account. No-op when disabled.
 * Pass `requesterIp` to increment the IP+account composite bucket (DD-LOGIN-F5).
 */
export const recordAuthFailure = async (accountKey: string, requesterIp?: string): Promise<void> => {
  const cfg = getAuthLockoutConfig();
  if (!cfg || !accountKey) return;
  //? Increment BOTH the cross-IP bare-account counter and (when an IP is known)
  //? the per-IP composite counter — mirrors the dual gate in isAccountLocked.
  const account = await checkRateLimit({
    key: lockoutKey(accountKey),
    limit: cfg.maxAttemptsPerAccount,
    windowMs: cfg.windowMs,
  });
  let ipBlocked = false;
  if (requesterIp) {
    const ip = await checkRateLimit({
      key: lockoutKey(accountKey, requesterIp),
      limit: cfg.maxAttempts,
      windowMs: cfg.windowMs,
    });
    ipBlocked = !ip.allowed;
  }
  if (!account.allowed || ipBlocked) {
    getLogger().warn('[authLockout] account temporarily locked after repeated failures', {
      maxAttempts: cfg.maxAttempts,
      maxAttemptsPerAccount: cfg.maxAttemptsPerAccount,
      crossIp: !account.allowed,
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
  //? Clear BOTH counters on a successful login so earlier typos don't penalise the
  //? user — the cross-IP bare-account bucket and the per-IP composite bucket.
  await clearRateLimit(lockoutKey(accountKey));
  if (requesterIp) await clearRateLimit(lockoutKey(accountKey, requesterIp));
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
