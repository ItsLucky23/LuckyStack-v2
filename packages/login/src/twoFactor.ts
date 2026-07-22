//? @adr 0035
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
import { acquireLease, dispatchHook, formatKey, getLogger, getProjectConfig, getProjectName, redis, releaseLease, tryCatch } from '@luckystack/core';

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

//? ─────────────── TOTP secret at rest (AES-256-GCM, rotatable) ───────────────
//? New writes carry a non-secret key identifier: `enc:v2:<kid>:<iv>:<tag>:<data>`.
//? `TOTP_ENCRYPTION_KEY` is the primary write key;
//? `TOTP_ENCRYPTION_LEGACY_KEYS` is a JSON string array of decrypt-only keys.
//? Legacy `gcm:<iv>:<tag>:<data>` and plaintext rows remain readable and are
//? lazily re-encrypted after the next successful TOTP proof.

const LEGACY_ENCRYPTED_PREFIX = 'gcm:';
const VERSIONED_ENCRYPTED_PREFIX = 'enc:v2:';
const KEY_ID_LENGTH = 24;
let warnedPlaintextSecret = false;
let warnedInvalidLegacyKeyRing = false;

interface TotpEncryptionKey {
  id: string;
  key: Buffer;
}

interface DecryptedTotpSecret {
  secret: string;
  needsReencrypt: boolean;
}

const toEncryptionKey = (raw: string): TotpEncryptionKey => ({
  id: crypto.createHash('sha256').update(`luckystack-totp-key-id:${raw}`).digest('hex').slice(0, KEY_ID_LENGTH),
  key: crypto.createHash('sha256').update(raw).digest(),
});

const readLegacyEncryptionKeys = (): string[] => {
  const raw = process.env.TOTP_ENCRYPTION_LEGACY_KEYS;
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new TypeError('expected a JSON array of non-empty strings');
    }
    const keys: string[] = [];
    for (const value of parsed) {
      if (typeof value !== 'string' || value.length === 0) {
        throw new TypeError('expected a JSON array of non-empty strings');
      }
      keys.push(value);
    }
    return keys;
  } catch {
    if (!warnedInvalidLegacyKeyRing) {
      warnedInvalidLegacyKeyRing = true;
      getLogger().error('[2fa] TOTP_ENCRYPTION_LEGACY_KEYS must be a JSON array of non-empty strings; legacy TOTP rows cannot be decrypted until it is fixed.');
    }
    return [];
  }
};

const encryptionKeyRing = (): { primary: TotpEncryptionKey | null; all: TotpEncryptionKey[] } => {
  const primaryRaw = process.env.TOTP_ENCRYPTION_KEY;
  const primary = primaryRaw ? toEncryptionKey(primaryRaw) : null;
  const seen = new Set<string>();
  const all: TotpEncryptionKey[] = [];
  for (const raw of [primaryRaw, ...readLegacyEncryptionKeys()]) {
    if (!raw) continue;
    const entry = toEncryptionKey(raw);
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    all.push(entry);
  }
  return { primary, all };
};

const decryptWithKey = (
  key: Buffer,
  ivPart: string,
  tagPart: string,
  dataPart: string,
): string | null => {
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivPart, 'base64'));
    decipher.setAuthTag(Buffer.from(tagPart, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataPart, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
};

export const encryptTotpSecret = (secret: string): string => {
  const { primary } = encryptionKeyRing();
  if (!primary) {
    if (!warnedPlaintextSecret) {
      warnedPlaintextSecret = true;
      getLogger().warn('[2fa] TOTP_ENCRYPTION_KEY is not set — TOTP secrets are stored unencrypted. Set it in .env.local to encrypt new enrollments at rest.');
    }
    return secret;
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', primary.key, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return `${VERSIONED_ENCRYPTED_PREFIX}${primary.id}:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${ciphertext.toString('base64')}`;
};

const decryptTotpSecretWithMetadata = (stored: string): DecryptedTotpSecret | null => {
  const ring = encryptionKeyRing();
  if (!stored.startsWith(LEGACY_ENCRYPTED_PREFIX) && !stored.startsWith('enc:')) {
    return { secret: stored, needsReencrypt: ring.primary !== null };
  }

  if (stored.startsWith(VERSIONED_ENCRYPTED_PREFIX)) {
    const [keyId, ivPart, tagPart, dataPart] = stored.slice(VERSIONED_ENCRYPTED_PREFIX.length).split(':');
    if (!keyId || !ivPart || !tagPart || !dataPart) return null;
    const entry = ring.all.find((candidate) => candidate.id === keyId);
    if (!entry) {
      getLogger().error('[2fa] TOTP secret references an unavailable encryption key id. Add the previous key to TOTP_ENCRYPTION_LEGACY_KEYS.');
      return null;
    }
    const secret = decryptWithKey(entry.key, ivPart, tagPart, dataPart);
    if (!secret) {
      getLogger().error('[2fa] TOTP secret decryption failed (ciphertext is invalid or the configured key is wrong).');
      return null;
    }
    return {
      secret,
      needsReencrypt: ring.primary !== null && entry.id !== ring.primary.id,
    };
  }

  if (!stored.startsWith(LEGACY_ENCRYPTED_PREFIX)) {
    getLogger().error('[2fa] unsupported TOTP ciphertext version.');
    return null;
  }
  const [ivPart, tagPart, dataPart] = stored.slice(LEGACY_ENCRYPTED_PREFIX.length).split(':');
  if (!ivPart || !tagPart || !dataPart || ring.all.length === 0) {
    getLogger().error('[2fa] found a legacy encrypted TOTP secret but no matching primary/legacy key is configured.');
    return null;
  }
  for (const entry of ring.all) {
    const secret = decryptWithKey(entry.key, ivPart, tagPart, dataPart);
    if (secret) return { secret, needsReencrypt: ring.primary !== null };
  }
  getLogger().error('[2fa] legacy TOTP secret decryption failed with every configured key.');
  return null;
};

export const decryptTotpSecret = (stored: string): string | null =>
  decryptTotpSecretWithMetadata(stored)?.secret ?? null;

//? ─────────────── challenge store ───────────────

interface ChallengeRecord {
  userId: string;
  email?: string;
}

const challengeKey = (token: string): string => formatKey('-2fa-challenge', sha256(token));
const challengeAttemptsKey = (token: string): string => formatKey('-2fa-challenge-attempts', sha256(token));
//? Replay guard: per-(user, timestep) used-marker. Set with `NX` so the
//? claim is ATOMIC — two concurrent verifies of the same code race on the
//? same key and exactly one wins (the earlier get-highest-step-then-set was a
//? TOCTOU: both could read the old value and both pass). TTL covers the ±drift
//? window; after it the timestep is already outside `now ± drift` so verifyTotp
//? rejects it anyway.
const usedTimestepKey = (userId: string, timestep: number): string => formatKey('-2fa-usedstep', `${userId}:${String(timestep)}`);
//? Cross-challenge, identity-keyed 2FA failure counter. The per-challenge
//? budget alone is resettable — a password-holding attacker mints a fresh
//? challenge per try — so this account-level counter locks the second factor
//? after too many failures in the window, independent of IP (a botnet can't
//? scale past it).
const accountFailureKey = (userId: string): string => formatKey('-2fa-accountfail', userId);
const RECOVERY_LEASE_MS = 5000;
const recoveryLeaseName = (userId: string): string => `2fa-recovery:${userId}`;
const ENROLLMENT_LEASE_MS = 30_000;
const enrollmentLeaseName = (userId: string): string => `2fa-enrollment:${userId}`;
//? Pending (unconfirmed) enrollment secret — only written to the user record
//? once the user proves the app is set up by entering a first valid code.
const pendingSecretKey = (userId: string): string => formatKey('-2fa-pending', userId);

//? Account-level 2FA lockout window/limit. Fixed (not a new config key to keep
//? the surface lean) — 10 failed second-factor attempts per 15 min per account
//? across ALL challenges/IPs. Generous for a fat-fingered legit user, a hard
//? ceiling for a grind.
const ACCOUNT_FAIL_LIMIT = 10;
const ACCOUNT_FAIL_WINDOW_SECONDS = 15 * 60;

const isTwoFactorAccountLocked = async (userId: string): Promise<boolean> => {
  const count = Number((await redis.get(accountFailureKey(userId))) ?? '0');
  return count >= ACCOUNT_FAIL_LIMIT;
};
const recordTwoFactorAccountFailure = async (userId: string): Promise<void> => {
  const key = accountFailureKey(userId);
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, ACCOUNT_FAIL_WINDOW_SECONDS);
};
const clearTwoFactorAccountFailures = async (userId: string): Promise<void> => {
  await redis.del(accountFailureKey(userId));
};

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

//? `enforceSingleUse` — the timestep replay guard is a LOGIN-boundary defense:
//? an intercepted code must not be replayable to complete a challenge. It is
//? applied on the login path only. Session-authenticated management actions
//? (disable / regenerate) do a plain proof-of-possession verify WITHOUT the
//? guard — otherwise a user who just logged in with a TOTP code could not
//? manage 2FA until their authenticator rolled to the next code (their app
//? still shows the one they just burned). Those actions are already gated by
//? the live session, so replaying a management code buys an attacker nothing
//? they couldn't already do with that session.
const verifyTotpForUser = async (user: UserRecord, code: string, enforceSingleUse: boolean): Promise<boolean> => {
  if (!user.totpSecret) return false;
  //? Pin to the 6 digits we provision (otpauth URI declares digits=6). The
  //? generic verifyTotp accepts 6–8 for RFC completeness; the auth surface
  //? must not (a longer guess is a spec deviation with no benefit).
  if (!/^\d{6}$/.test(code.trim())) return false;
  const decrypted = decryptTotpSecretWithMetadata(user.totpSecret);
  if (!decrypted) return false;
  const result = verifyTotp({ secret: decrypted.secret, code });
  if (!result.valid || result.timestep === null) return false;

  if (enforceSingleUse) {
    //? Single-use on the login boundary: atomically CLAIM this (user, timestep)
    //? with `NX`. If the marker already exists the code was already redeemed —
    //? refuse. `NX` makes the claim race-free (fixes the earlier get-then-set
    //? TOCTOU where two concurrent verifies of the same code both passed).
    const claimed = await redis.set(usedTimestepKey(user.id, result.timestep), '1', 'EX', 60 * 2, 'NX');
    if (claimed === null) return false;
  }

  //? Rotation is lazy and proof-gated: only after a valid authenticator code do
  //? we rewrite plaintext/v1/legacy-key ciphertext under the current primary.
  //? Migration failure must not lock a user out; the old decryptable row stays.
  if (decrypted.needsReencrypt) {
    const [migrationError] = await tryCatch(() => getUserAdapter().update(user.id, {
      totpSecret: encryptTotpSecret(decrypted.secret),
    }));
    if (migrationError) {
      getLogger().error('[2fa] TOTP encryption-key lazy migration failed; verification succeeded but the existing ciphertext was kept.', migrationError);
    }
  }
  return true;
};

const matchRecoveryHash = (hashes: string[], code: string): number => {
  const submitted = Buffer.from(sha256(code.trim().toLowerCase()));
  return hashes.findIndex((hash) => {
    const stored = Buffer.from(hash);
    return stored.length === submitted.length && crypto.timingSafeEqual(stored, submitted);
  });
};

//? Burning a recovery code is a read-modify-write on the user record's array,
//? which the generic UserAdapter can't do atomically. Two concurrent uses of
//? the SAME code could both match + both persist (double-spend), and two
//? concurrent uses of DIFFERENT codes could last-writer-wins-overwrite each
//? other (a lost update that resurrects a burned code). Serialize the whole
//? read→match→burn per user with a short Redis lease, and RE-READ inside the
//? lease so the burn always writes against fresh state. If the lease can't be
//? taken (contention), fail closed — the caller can retry.
const consumeRecoveryCode = async (user: UserRecord, code: string): Promise<boolean> => {
  if ((user.recoveryCodes ?? []).length === 0) return false;
  const leaseToken = await acquireLease(recoveryLeaseName(user.id), RECOVERY_LEASE_MS);
  if (!leaseToken) {
    getLogger().warn('[2fa] recovery-code burn is contended (lease busy) — refusing this attempt, retry');
    return false;
  }
  try {
    //? Re-read under the lease: `user` was fetched before the lease, so its
    //? recoveryCodes array may be stale relative to a concurrent burn.
    const fresh = await getUserAdapter().findById(user.id);
    const hashes = fresh?.recoveryCodes ?? [];
    const index = matchRecoveryHash(hashes, code);
    if (index === -1) return false;
    const remaining = hashes.filter((_, position) => position !== index);
    const [updateError] = await tryCatch(() => getUserAdapter().update(user.id, { recoveryCodes: remaining }));
    //? Fail CLOSED: if the burn can't be persisted the code stays reusable — refuse it.
    if (updateError) {
      getLogger().error('[2fa] could not persist recovery-code consumption — refusing the code', updateError);
      return false;
    }
    return true;
  } finally {
    await releaseLease(recoveryLeaseName(user.id), leaseToken);
  }
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

  //? Cross-challenge, identity-keyed lockout FIRST (non-incrementing read).
  //? The per-challenge budget below is resettable by minting a fresh challenge
  //? (a password-holder can), so this account-level ceiling is what actually
  //? stops a distributed grind of the second factor.
  if (await isTwoFactorAccountLocked(challenge.userId)) {
    return { status: false, reason: 'login.twoFactorLocked' };
  }

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
    //? Login boundary → enforce the single-use timestep replay guard.
    verified = await verifyTotpForUser(user, input.code, true);
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
    await recordTwoFactorAccountFailure(user.id);
    void dispatchHook('loginFailed', { email: user.email ?? undefined, userId: user.id, provider: 'credentials', reason: 'login.twoFactorInvalidCode', stage: 'login', requesterIp: input.requesterIp });
    return { status: false, reason: 'login.twoFactorInvalidCode' };
  }

  await burnChallenge(input.challengeToken);
  await clearEmailCode('2fa', user.id);
  await clearTwoFactorAccountFailures(user.id);
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

export type TotpEnrollmentStart =
  | { ok: true; secret: string; otpauthUri: string }
  | { ok: false; reason: string };

//? Guard shared by setup + confirm: enrolling is refused when the feature is
//? globally disabled (would give a false sense of security — the login gate
//? never fires) AND when 2FA is ALREADY enabled. The second is the important
//? one: without it a hijacked (2FA-less) session could call setup+enable to
//? OVERWRITE the victim's factor with the attacker's — strictly worse than the
//? disable path, which already requires a current code. Re-enrolling therefore
//? requires disabling first (which proves current possession).
const enrollmentBlockedReason = (user: UserRecord): string | null => {
  if (twoFactorConfig().twoFactor === 'disabled') return 'login.twoFactorDisabledByServer';
  if (user.twoFactorEnabled) return 'login.twoFactorAlreadyEnabled';
  return null;
};

/**
 * Step 1: mint a secret and park it as PENDING (Redis, 10 min) — the user
 * record is untouched until the user proves the app works via
 * `confirmTotpEnrollment`. Re-calling replaces the pending secret. Refused for
 * an already-enrolled user / a disabled feature (see enrollmentBlockedReason).
 */
export const beginTotpEnrollment = async (user: UserRecord): Promise<TotpEnrollmentStart> => {
  const blocked = enrollmentBlockedReason(user);
  if (blocked) return { ok: false, reason: blocked };
  const secret = generateTotpSecret();
  await redis.set(pendingSecretKey(user.id), encryptTotpSecret(secret), 'EX', 60 * 10);
  return {
    ok: true,
    secret,
    otpauthUri: buildOtpauthUri({ secret, accountName: user.email ?? user.id, issuer: getProjectName() }),
  };
};

//? 80 bits of entropy per code (10 random bytes → 20 hex, grouped 5×4 for
//? readability). 40 bits (the earlier 5 bytes) is offline-crackable against an
//? unsalted sha256 store if the user table leaks; 80 bits is not.
const generateRecoveryCodes = (): { raw: string[]; hashes: string[] } => {
  const raw = Array.from({ length: 10 }, () => {
    const hex = crypto.randomBytes(10).toString('hex');
    return `${hex.slice(0, 5)}-${hex.slice(5, 10)}-${hex.slice(10, 15)}-${hex.slice(15, 20)}`;
  });
  return { raw, hashes: raw.map((code) => sha256(code.toLowerCase())) };
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
  //? Re-check the block here too (defense in depth — a stale pending secret
  //? could otherwise be confirmed after 2FA was enabled by another path).
  const blocked = enrollmentBlockedReason(user);
  if (blocked) return { ok: false, reason: blocked };

  //? The generic UserAdapter cannot atomically combine "consume pending" with
  //? the user update. Serialize the whole read → verify → recovery-code mint →
  //? persist → delete sequence per user. Without this, two confirms could both
  //? return success with DIFFERENT raw recovery sets while only the last DB
  //? write remained valid. Contention fails closed as an expired/consumed setup.
  const leaseToken = await acquireLease(enrollmentLeaseName(user.id), ENROLLMENT_LEASE_MS);
  if (!leaseToken) return { ok: false, reason: 'login.twoFactorEnrollmentExpired' };
  try {
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
  } finally {
    await releaseLease(enrollmentLeaseName(user.id), leaseToken);
  }
};

/**
 * Disable 2FA. Requires a currently-valid TOTP code OR an unused recovery
 * code, so a hijacked (but 2FA-less) session can't silently strip the factor.
 */
export const disableTwoFactor = async (user: UserRecord, code: string): Promise<{ ok: boolean; reason?: string }> => {
  //? Management action (session-authenticated) → plain proof-of-possession, no
  //? single-use guard, so a just-logged-in user isn't blocked for 30s.
  const viaTotp = await verifyTotpForUser(user, code, false);
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
  //? Clear any lingering account-lockout counter so re-enrolling later starts clean.
  await clearTwoFactorAccountFailures(user.id);
  return { ok: true };
};

/** Replace the recovery-code set (requires a valid current TOTP code). */
export const regenerateRecoveryCodes = async (user: UserRecord, code: string): Promise<ConfirmTotpEnrollmentResult> => {
  //? Management action → plain verify (see disableTwoFactor).
  if (!(await verifyTotpForUser(user, code, false))) return { ok: false, reason: 'login.twoFactorInvalidCode' };
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
