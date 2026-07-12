//? 2FA flow layer (ADR 0024) on top of the totp.ts primitive. Methods:
//?   - 'totp'          — authenticator apps (Google/Microsoft Authenticator,
//?                       Authy, …) via the open TOTP standard; primary channel.
//?   - 'email-code'    — "send the code to my email instead" fallback
//?                       (config `auth.twoFactorEmailFallback`, needs email).
//?   - 'recovery-code' — one-time backup codes minted at enrollment.
//?
//? Login integration: this module registers the 2FA GATE into login.ts at
//? module init (registerTwoFactorGate — the DI idiom that avoids a module
//? cycle). After the first factor verifies, the gate parks the login as a
//? short-lived Redis CHALLENGE (high-entropy token, hashed at rest) instead of
//? minting a session; `verifyTwoFactorChallenge` completes it through the same
//? `finalizeLogin` tail the password path uses.
//?
//? The challenge is deliberately NOT the core one-time-token primitive: a
//? wrong 2FA code must not burn the whole challenge (the user gets
//? `twoFactorMaxAttempts` tries), so reads don't consume — success or the
//? spent attempt budget does.

import crypto from 'node:crypto';
import { dispatchHook, formatKey, getLogger, getProjectConfig, getProjectName, redis, tryCatch } from '@luckystack/core';

import { issueEmailCode, verifyEmailCode, clearEmailCode } from './emailOtp';
import { loadEmailModule } from './emailModuleLoader';
import { buildOtpauthUri, generateTotpSecret, verifyTotp } from './totp';
import { getUserAdapter, type UserRecord } from './userAdapter';
import {
  finalizeLogin,
  registerTwoFactorGate,
  type CredentialsLoginChallenge,
  type CredentialsLoginResult,
  type TwoFactorMethod,
} from './login';

const sha256 = (value: string): string => crypto.createHash('sha256').update(value).digest('hex');

//? ─────────────── TOTP secret at rest (AES-256-GCM, optional) ───────────────
//? With `TOTP_ENCRYPTION_KEY` set (any string; key = sha256 of it) secrets are
//? stored as `gcm:<iv>:<tag>:<ciphertext>`; without it they are stored as the
//? plain base32 string (warned once). Decrypt accepts BOTH forms, so adding
//? the env key later upgrades new writes without breaking existing users.

const ENCRYPTED_PREFIX = 'gcm:';
let warnedPlaintextSecret = false;

const encryptionKey = (): Buffer | null => {
  const raw = process.env.TOTP_ENCRYPTION_KEY;
  if (!raw) return null;
  return crypto.createHash('sha256').update(raw).digest();
};

export const encryptTotpSecret = (secret: string): string => {
  const key = encryptionKey();
  if (!key) {
    if (!warnedPlaintextSecret) {
      warnedPlaintextSecret = true;
      getLogger().warn('[2fa] TOTP_ENCRYPTION_KEY is not set — TOTP secrets are stored unencrypted. Set it in .env.local to encrypt new enrollments at rest.');
    }
    return secret;
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return `${ENCRYPTED_PREFIX}${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${ciphertext.toString('base64')}`;
};

export const decryptTotpSecret = (stored: string): string | null => {
  if (!stored.startsWith(ENCRYPTED_PREFIX)) return stored; //? legacy/keyless plaintext
  const key = encryptionKey();
  if (!key) {
    getLogger().error('[2fa] found an encrypted TOTP secret but TOTP_ENCRYPTION_KEY is not set — cannot verify TOTP codes.');
    return null;
  }
  const [ivPart, tagPart, dataPart] = stored.slice(ENCRYPTED_PREFIX.length).split(':');
  if (!ivPart || !tagPart || !dataPart) return null;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivPart, 'base64'));
    decipher.setAuthTag(Buffer.from(tagPart, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataPart, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    getLogger().error('[2fa] TOTP secret decryption failed (wrong TOTP_ENCRYPTION_KEY?).');
    return null;
  }
};

//? ─────────────── challenge store ───────────────

interface ChallengeRecord {
  userId: string;
  email?: string;
}

const challengeKey = (token: string): string => formatKey('-2fa-challenge', sha256(token));
const challengeAttemptsKey = (token: string): string => formatKey('-2fa-challenge-attempts', sha256(token));
//? Replay guard: highest accepted TOTP timestep per user. TTL comfortably
//? covers the ±window drift so an intercepted code can't be replayed.
const lastTimestepKey = (userId: string): string => formatKey('-2fa-laststep', userId);
//? Pending (unconfirmed) enrollment secret — only written to the user record
//? once the user proves the app is set up by entering a first valid code.
const pendingSecretKey = (userId: string): string => formatKey('-2fa-pending', userId);

const twoFactorConfig = () => getProjectConfig().auth;

export const availableTwoFactorMethods = (user: UserRecord): TwoFactorMethod[] => {
  const methods: TwoFactorMethod[] = [];
  if (user.totpSecret) methods.push('totp');
  if (twoFactorConfig().twoFactorEmailFallback && user.email) methods.push('email-code');
  if ((user.recoveryCodes ?? []).length > 0) methods.push('recovery-code');
  return methods;
};

//? The login gate: park the verified first factor as a challenge when the
//? user enrolled 2FA (and the feature isn't globally disabled).
export const createTwoFactorChallengeIfRequired = async (
  user: UserRecord,
  _context: { requesterIp?: string },
): Promise<CredentialsLoginChallenge | null> => {
  if (twoFactorConfig().twoFactor === 'disabled') return null;
  if (!user.twoFactorEnabled || !user.totpSecret) return null;

  const methods = availableTwoFactorMethods(user);
  const token = crypto.randomBytes(32).toString('hex');
  const record: ChallengeRecord = { userId: user.id, email: user.email ?? undefined };
  await redis.set(challengeKey(token), JSON.stringify(record), 'EX', twoFactorConfig().twoFactorChallengeTtlSeconds);
  return {
    status: true,
    reason: 'login.twoFactorRequired',
    requiresTwoFactor: true,
    challengeToken: token,
    twoFactorMethods: methods,
  };
};

const readChallenge = async (token: string): Promise<ChallengeRecord | null> => {
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const raw = await redis.get(challengeKey(token));
  if (!raw) return null;
  const [parseError, parsed] = await tryCatch(() => Promise.resolve(JSON.parse(raw) as ChallengeRecord));
  if (parseError || typeof parsed?.userId !== 'string') return null;
  return parsed;
};

const burnChallenge = async (token: string): Promise<void> => {
  await redis.del(challengeKey(token));
  await redis.del(challengeAttemptsKey(token));
};

//? ─────────────── verification (completes the login) ───────────────

const verifyTotpForUser = async (user: UserRecord, code: string): Promise<boolean> => {
  if (!user.totpSecret) return false;
  const secret = decryptTotpSecret(user.totpSecret);
  if (!secret) return false;
  const result = verifyTotp({ secret, code });
  if (!result.valid || result.timestep === null) return false;

  //? Single-use across the drift window: refuse any timestep at or below the
  //? highest one this user already redeemed.
  const guardKey = lastTimestepKey(user.id);
  const lastAccepted = Number((await redis.get(guardKey)) ?? '0');
  if (result.timestep <= lastAccepted) return false;
  await redis.set(guardKey, String(result.timestep), 'EX', 60 * 10);
  return true;
};

const consumeRecoveryCode = async (user: UserRecord, code: string): Promise<boolean> => {
  const hashes = user.recoveryCodes ?? [];
  const submitted = sha256(code.trim().toLowerCase());
  const index = hashes.findIndex((hash) => {
    const a = Buffer.from(hash);
    const b = Buffer.from(submitted);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
  if (index === -1) return false;
  const remaining = hashes.filter((_, position) => position !== index);
  const [updateError] = await tryCatch(() => getUserAdapter().update(user.id, { recoveryCodes: remaining }));
  //? Fail CLOSED: if the burn can't be persisted the code stays reusable — refuse it.
  if (updateError) {
    getLogger().error('[2fa] could not persist recovery-code consumption — refusing the code', updateError);
    return false;
  }
  return true;
};

export interface VerifyTwoFactorInput {
  challengeToken: string;
  code: string;
  /** Defaults to 'totp'; the client sends what the user picked. */
  method?: TwoFactorMethod;
  supersedeToken?: string;
  requesterIp?: string;
}

export const verifyTwoFactorChallenge = async (input: VerifyTwoFactorInput): Promise<CredentialsLoginResult> => {
  const challenge = await readChallenge(input.challengeToken);
  if (!challenge) return { status: false, reason: 'login.twoFactorChallengeExpired' };

  //? Attempt budget on the CHALLENGE (all methods combined). INCR is atomic;
  //? the counter inherits the challenge TTL.
  const counter = challengeAttemptsKey(input.challengeToken);
  const attempts = await redis.incr(counter);
  const remaining = await redis.ttl(challengeKey(input.challengeToken));
  if (remaining > 0) await redis.expire(counter, remaining);
  if (attempts > twoFactorConfig().twoFactorMaxAttempts) {
    await burnChallenge(input.challengeToken);
    return { status: false, reason: 'login.twoFactorLocked' };
  }

  const user = await getUserAdapter().findById(challenge.userId);
  if (!user) {
    await burnChallenge(input.challengeToken);
    return { status: false, reason: 'login.twoFactorChallengeExpired' };
  }

  const method: TwoFactorMethod = input.method ?? 'totp';
  let verified = false;
  if (method === 'totp') {
    verified = await verifyTotpForUser(user, input.code);
  } else if (method === 'email-code') {
    if (!twoFactorConfig().twoFactorEmailFallback) return { status: false, reason: 'login.twoFactorMethodUnavailable' };
    verified = (await verifyEmailCode({
      purpose: '2fa',
      identity: user.id,
      code: input.code,
      maxAttempts: twoFactorConfig().emailCodeMaxAttempts,
    })) === 'valid';
  } else {
    verified = await consumeRecoveryCode(user, input.code);
  }

  if (!verified) {
    void dispatchHook('loginFailed', { email: user.email ?? undefined, userId: user.id, provider: 'credentials', reason: 'login.twoFactorInvalidCode', stage: 'login', requesterIp: input.requesterIp });
    return { status: false, reason: 'login.twoFactorInvalidCode' };
  }

  await burnChallenge(input.challengeToken);
  await clearEmailCode('2fa', user.id);
  return finalizeLogin(user, {
    provider: 'credentials',
    email: user.email ?? undefined,
    supersedeToken: input.supersedeToken,
    requesterIp: input.requesterIp,
  });
};

//? "Send the code to my email instead" — bound to an ACTIVE challenge so it
//? can't be used to spam arbitrary users. Always answers ok (the challenge
//? token itself already proves a verified first factor).
export const requestTwoFactorEmailCode = async (challengeToken: string): Promise<{ ok: boolean; reason?: string }> => {
  if (!twoFactorConfig().twoFactorEmailFallback) return { ok: false, reason: 'login.twoFactorMethodUnavailable' };
  const challenge = await readChallenge(challengeToken);
  if (!challenge) return { ok: false, reason: 'login.twoFactorChallengeExpired' };
  const user = await getUserAdapter().findById(challenge.userId);
  if (!user?.email) return { ok: false, reason: 'login.twoFactorChallengeExpired' };

  const config = twoFactorConfig();
  const code = await issueEmailCode({
    purpose: '2fa',
    identity: user.id,
    ttlSeconds: config.emailCodeTtlSeconds,
    digits: config.emailCodeLength,
  });
  const sent = await sendCodeEmail(user.email, code, 'Your verification code', `Use this code to finish signing in to ${getProjectName()}.`);
  return sent ? { ok: true } : { ok: false, reason: 'login.emailCodeSendFailed' };
};

//? Shared minimal code email (also used by the email-code LOGIN flow). Uses a
//? raw subject/html send so no template registration is required; the code is
//? digits-only so no HTML escaping concerns.
export const sendCodeEmail = async (to: string, code: string, subject: string, intro: string): Promise<boolean> => {
  const [loadError, email] = await tryCatch(() => loadEmailModule());
  if (loadError || !email) {
    getLogger().error('[2fa/email-code] @luckystack/email is not installed — cannot send the code email.');
    return false;
  }
  //? Visual spacing between digits ("1 2 3 4 5 6") — codes are digits-only.
  const spaced = code.match(/\d/g)?.join(' ') ?? code;
  const [sendError, result] = await tryCatch(() => email.sendEmail({
    to,
    subject,
    html: `<p>${intro}</p><p style="font-size:28px;font-weight:700;letter-spacing:6px;font-family:monospace">${spaced}</p><p>The code expires in ${String(Math.round(twoFactorConfig().emailCodeTtlSeconds / 60))} minutes. If you didn't request it, you can ignore this email.</p>`,
    text: `${intro}\n\nCode: ${code}\n\nThe code expires in ${String(Math.round(twoFactorConfig().emailCodeTtlSeconds / 60))} minutes. If you didn't request it, you can ignore this email.`,
    adapterHint: 'transactional',
  }));
  if (sendError || !result?.ok) {
    getLogger().error('[2fa/email-code] sending the code email failed', sendError ?? new Error(result?.reason ?? 'unknown'));
    return false;
  }
  return true;
};

//? ─────────────── enrollment (authenticated user) ───────────────

export interface TotpEnrollmentStart {
  /** base32 secret for manual entry in the authenticator app. */
  secret: string;
  /** otpauth:// URI to render as a QR code client-side. */
  otpauthUri: string;
}

/**
 * Step 1: mint a secret and park it as PENDING (Redis, 10 min) — the user
 * record is untouched until the user proves the app works via
 * `confirmTotpEnrollment`. Re-calling replaces the pending secret.
 */
export const beginTotpEnrollment = async (user: UserRecord): Promise<TotpEnrollmentStart> => {
  const secret = generateTotpSecret();
  await redis.set(pendingSecretKey(user.id), encryptTotpSecret(secret), 'EX', 60 * 10);
  return {
    secret,
    otpauthUri: buildOtpauthUri({ secret, accountName: user.email ?? user.id, issuer: getProjectName() }),
  };
};

const generateRecoveryCodes = (): { raw: string[]; hashes: string[] } => {
  const raw = Array.from({ length: 10 }, () => {
    const hex = crypto.randomBytes(5).toString('hex');
    return `${hex.slice(0, 5)}-${hex.slice(5)}`;
  });
  return { raw, hashes: raw.map((code) => sha256(code)) };
};

export type ConfirmTotpEnrollmentResult =
  | { ok: true; recoveryCodes: string[] }
  | { ok: false; reason: string };

/**
 * Step 2: the user enters the first code from their app. On success the
 * secret + recovery-code hashes land on the user record and 2FA is ON.
 * The RAW recovery codes are returned exactly once — show + let them save.
 */
export const confirmTotpEnrollment = async (user: UserRecord, code: string): Promise<ConfirmTotpEnrollmentResult> => {
  const pendingStored = await redis.get(pendingSecretKey(user.id));
  if (!pendingStored) return { ok: false, reason: 'login.twoFactorEnrollmentExpired' };
  const secret = decryptTotpSecret(pendingStored);
  if (!secret) return { ok: false, reason: 'login.twoFactorEnrollmentExpired' };

  const result = verifyTotp({ secret, code });
  if (!result.valid) return { ok: false, reason: 'login.twoFactorInvalidCode' };

  const { raw, hashes } = generateRecoveryCodes();
  const [updateError] = await tryCatch(() => getUserAdapter().update(user.id, {
    totpSecret: encryptTotpSecret(secret),
    twoFactorEnabled: true,
    recoveryCodes: hashes,
  }));
  if (updateError) {
    getLogger().error('[2fa] enrollment persist failed — is your UserAdapter/schema missing the 2FA fields? (twoFactorEnabled, totpSecret, recoveryCodes)', updateError);
    return { ok: false, reason: 'login.twoFactorPersistFailed' };
  }
  await redis.del(pendingSecretKey(user.id));
  return { ok: true, recoveryCodes: raw };
};

/**
 * Disable 2FA. Requires a currently-valid TOTP code OR an unused recovery
 * code, so a hijacked (but 2FA-less) session can't silently strip the factor.
 */
export const disableTwoFactor = async (user: UserRecord, code: string): Promise<{ ok: boolean; reason?: string }> => {
  const viaTotp = await verifyTotpForUser(user, code);
  const viaRecovery = viaTotp ? false : await consumeRecoveryCode(user, code);
  if (!viaTotp && !viaRecovery) return { ok: false, reason: 'login.twoFactorInvalidCode' };

  const [updateError] = await tryCatch(() => getUserAdapter().update(user.id, {
    totpSecret: null,
    twoFactorEnabled: false,
    recoveryCodes: [],
  }));
  if (updateError) {
    getLogger().error('[2fa] disable persist failed', updateError);
    return { ok: false, reason: 'login.twoFactorPersistFailed' };
  }
  await redis.del(lastTimestepKey(user.id));
  return { ok: true };
};

/** Replace the recovery-code set (requires a valid current TOTP code). */
export const regenerateRecoveryCodes = async (user: UserRecord, code: string): Promise<ConfirmTotpEnrollmentResult> => {
  if (!(await verifyTotpForUser(user, code))) return { ok: false, reason: 'login.twoFactorInvalidCode' };
  const { raw, hashes } = generateRecoveryCodes();
  const [updateError] = await tryCatch(() => getUserAdapter().update(user.id, { recoveryCodes: hashes }));
  if (updateError) {
    getLogger().error('[2fa] recovery-code regenerate persist failed', updateError);
    return { ok: false, reason: 'login.twoFactorPersistFailed' };
  }
  return { ok: true, recoveryCodes: raw };
};

//? Register the login gate (see header). Import of this module — via the
//? package index — is what arms 2FA; nothing changes for code paths that
//? never import it.
registerTwoFactorGate(createTwoFactorChallengeIfRequired);
