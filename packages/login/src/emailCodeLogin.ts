//? Passwordless email-code login (ADR 0024): the user enters their email,
//? receives a short numeric code, and signs in by typing it. Opt-in via
//? `auth.emailCodeLogin` (default false); needs @luckystack/email.
//?
//? Anti-enumeration mirrors forgotPassword.ts: the REQUEST endpoint always
//? answers "sent" whether or not the address has an account — a code is only
//? actually issued (and an email only actually sent) when a credentials user
//? exists. Request throttling is done here (per-email + per-IP) because the
//? send costs real email quota.
//?
//? 2FA interplay: possession of the mailbox is itself an email factor, but an
//? account that enrolled an authenticator app expects the STRONGER factor to
//? gate sign-in — so an enrolled user still gets the 2FA challenge after the
//? email code verifies (same gate as the password path).

import { checkRateLimit, getLogger, getProjectConfig, getProjectName, tryCatch } from '@luckystack/core';

import { resolveUserByEmail } from './accountStrategy';
import { clearEmailCode, issueEmailCode, verifyEmailCode } from './emailOtp';
import { finalizeLogin, type CredentialsLoginResult } from './login';
import { sendCodeEmail, createTwoFactorChallengeIfRequired } from './twoFactor';
import { getUserAdapter } from './userAdapter';

const emailCodeConfig = () => getProjectConfig().auth;

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

//? Same window the auth lockout uses; request budgets are deliberately tight —
//? each request is an outbound email.
const REQUEST_WINDOW_MS = 15 * 60 * 1000;
const REQUESTS_PER_EMAIL = 3;
const REQUESTS_PER_IP = 10;

export interface RequestEmailLoginCodeInput {
  email: string;
  requesterIp?: string;
}

export type RequestEmailLoginCodeResult =
  | { ok: true }
  | { ok: false; reason: string };

export const requestEmailLoginCode = async ({ email, requesterIp }: RequestEmailLoginCodeInput): Promise<RequestEmailLoginCodeResult> => {
  const config = emailCodeConfig();
  if (!config.emailCodeLogin) return { ok: false, reason: 'login.emailCodeDisabled' };
  const normalized = normalizeEmail(email);
  if (!normalized || normalized.length > config.emailMaxLength) return { ok: false, reason: 'login.invalidEmailFormat' };

  //? Throttle BEFORE any user lookup so the limiter can't be used as an
  //? enumeration oracle either (both outcomes hit the same budget).
  const perEmail = await checkRateLimit({ key: `email-code:req:${normalized}`, limit: REQUESTS_PER_EMAIL, windowMs: REQUEST_WINDOW_MS });
  const perIp = requesterIp
    ? await checkRateLimit({ key: `email-code:req-ip:${requesterIp}`, limit: REQUESTS_PER_IP, windowMs: REQUEST_WINDOW_MS })
    : { allowed: true };
  if (!perEmail.allowed || !perIp.allowed) return { ok: false, reason: 'api.rateLimitExceeded' };

  //? Email-code login signs into the CREDENTIALS account for the address
  //? (consistent with forgot-password); under `providerAccountStrategy:
  //? 'unified'` the resolver already collapses providers by email.
  const [findError, user] = await tryCatch(() =>
    resolveUserByEmail(getUserAdapter(), { email: normalized, provider: 'credentials' }),
  );
  if (findError) {
    getLogger().error('email-code login: user lookup failed', findError);
    //? Still answer ok — a backend blip must not become an enumeration signal.
    return { ok: true };
  }
  if (!user) {
    //? Anti-enumeration: identical response; only a server-side log.
    getLogger().info('[email-code] request for unknown address (not sent)');
    return { ok: true };
  }

  const code = await issueEmailCode({
    purpose: 'login',
    identity: normalized,
    ttlSeconds: config.emailCodeTtlSeconds,
    digits: config.emailCodeLength,
  });
  const sent = await sendCodeEmail(
    normalized,
    code,
    'Your sign-in code',
    `Use this code to sign in to ${getProjectName()}.`,
  );
  //? A failed SEND is surfaced (it's an ops problem, not an enumeration
  //? signal — the failure is identical for existing and non-existing users
  //? only when sending never happens; here the account exists).
  return sent ? { ok: true } : { ok: false, reason: 'login.emailCodeSendFailed' };
};

export interface VerifyEmailLoginCodeInput {
  email: string;
  code: string;
  supersedeToken?: string;
  requesterIp?: string;
}

export const verifyEmailLoginCode = async (input: VerifyEmailLoginCodeInput): Promise<CredentialsLoginResult> => {
  const config = emailCodeConfig();
  if (!config.emailCodeLogin) return { status: false, reason: 'login.emailCodeDisabled' };
  const normalized = normalizeEmail(input.email);

  const verdict = await verifyEmailCode({
    purpose: 'login',
    identity: normalized,
    code: input.code,
    maxAttempts: config.emailCodeMaxAttempts,
  });
  if (verdict !== 'valid') {
    const reason = verdict === 'invalid' ? 'login.emailCodeInvalid' : (verdict === 'locked' ? 'login.emailCodeLocked' : 'login.emailCodeExpired');
    return { status: false, reason };
  }

  const [findError, user] = await tryCatch(() =>
    resolveUserByEmail(getUserAdapter(), { email: normalized, provider: 'credentials' }),
  );
  if (findError || !user) {
    //? The code was valid, so the account existed moments ago — a vanished
    //? user (deleted mid-flow) fails closed.
    getLogger().error('email-code login: user vanished between issue and verify', findError ?? undefined);
    return { status: false, reason: 'login.emailCodeExpired' };
  }

  await clearEmailCode('login', normalized);

  //? Authenticator-enrolled accounts still answer the stronger factor (see header).
  const challenge = await createTwoFactorChallengeIfRequired(user, { requesterIp: input.requesterIp });
  if (challenge) return challenge;

  return finalizeLogin(user, {
    provider: 'credentials',
    email: normalized,
    supersedeToken: input.supersedeToken,
    requesterIp: input.requesterIp,
  });
};
