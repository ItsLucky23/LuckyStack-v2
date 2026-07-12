//? TOTP (RFC 6238) + HOTP (RFC 4226) — hand-rolled on node:crypto, zero deps.
//? Powers authenticator-app 2FA (Google/Microsoft Authenticator, Authy,
//? 1Password, …): they all speak this open standard via an otpauth:// URI.
//? Verification is timing-safe; replay protection is the CALLER's job — verify
//? returns the matched timestep so the flow layer can persist "last accepted
//? timestep" and reject codes at or before it (see twoFactor.ts).

import crypto from 'node:crypto';

//? RFC 4648 base32 alphabet — authenticator apps expect the shared secret in
//? base32 (both in the otpauth:// URI and for manual entry).
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export const base32Encode = (input: Buffer): string => {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of input) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
};

export const base32Decode = (input: string): Buffer | null => {
  //? Tolerant of the formats users paste: lowercase, spaces, `=` padding.
  const normalized = input.toUpperCase().replaceAll(/[\s=]/g, '');
  if (normalized.length === 0) return null;
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) return null;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xFF);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
};

//? HOTP (RFC 4226 §5.3): HMAC-SHA1 over the big-endian counter, dynamic
//? truncation, modulo 10^digits. Exported for the RFC test vectors.
export const hotp = (key: Buffer, counter: number, digits = 6): string => {
  const counterBuffer = Buffer.alloc(8);
  //? JS bitwise ops are 32-bit; write the 64-bit counter via BigInt.
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac('sha1', key).update(counterBuffer).digest();
  const offset = digest.readUInt8(digest.length - 1) & 0x0F;
  const binary = digest.readUInt32BE(offset) & 0x7F_FF_FF_FF;
  return String(binary % 10 ** digits).padStart(digits, '0');
};

export interface TotpVerifyInput {
  /** base32-encoded shared secret (as provisioned to the authenticator app). */
  secret: string;
  /** The user-entered code (digits; surrounding whitespace tolerated). */
  code: string;
  /**
   * Accepted clock drift in 30s steps on EITHER side of "now" (default 1 —
   * i.e. the previous, current and next code are accepted; RFC 6238 §5.2
   * recommends at most one backward step).
   */
  window?: number;
  /** Injection point for tests; defaults to the real clock. */
  timestampMs?: number;
}

export interface TotpVerifyResult {
  valid: boolean;
  /**
   * The timestep the code matched (only when valid). Persist the highest
   * accepted value per user and refuse `timestep <= lastAccepted` to make
   * every code single-use (replay protection across the drift window).
   */
  timestep: number | null;
}

const TOTP_STEP_SECONDS = 30;

export const verifyTotp = ({ secret, code, window = 1, timestampMs }: TotpVerifyInput): TotpVerifyResult => {
  const key = base32Decode(secret);
  const normalizedCode = code.trim();
  if (!key || key.length === 0 || !/^\d{6,8}$/.test(normalizedCode)) return { valid: false, timestep: null };

  const now = timestampMs ?? Date.now();
  const currentStep = Math.floor(now / 1000 / TOTP_STEP_SECONDS);
  const drift = Math.max(0, Math.min(window, 4)); //? cap: a huge window would defeat the point of TOTP

  //? Check EVERY step in the window (no early return) with a timing-safe
  //? comparison, so response time never leaks which step (if any) matched.
  let matched: number | null = null;
  for (let step = currentStep - drift; step <= currentStep + drift; step++) {
    const expected = hotp(key, step, normalizedCode.length);
    const expectedBuffer = Buffer.from(expected);
    const actualBuffer = Buffer.from(normalizedCode);
    if (expectedBuffer.length === actualBuffer.length && crypto.timingSafeEqual(expectedBuffer, actualBuffer)) {
      matched ??= step;
    }
  }
  return matched === null ? { valid: false, timestep: null } : { valid: true, timestep: matched };
};

/** 20 random bytes (RFC 4226 §4 minimum: 128 bits; 160 recommended), base32. */
export const generateTotpSecret = (): string => base32Encode(crypto.randomBytes(20));

export interface OtpauthUriInput {
  /** base32 secret from generateTotpSecret(). */
  secret: string;
  /** What the authenticator app shows as the account (usually the user's email). */
  accountName: string;
  /** App/brand name shown above the account (defaults to the project title). */
  issuer: string;
}

//? The provisioning URI encoded into the enrollment QR code. Every
//? authenticator app understands this format (Google's key-uri spec):
//? otpauth://totp/<issuer>:<account>?secret=…&issuer=…&algorithm=SHA1&digits=6&period=30
export const buildOtpauthUri = ({ secret, accountName, issuer }: OtpauthUriInput): string => {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(accountName)}`;
  const query = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${query.toString()}`;
};
