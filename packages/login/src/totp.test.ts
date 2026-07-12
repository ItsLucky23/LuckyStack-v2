import { describe, it, expect } from 'vitest';
import { base32Decode, base32Encode, buildOtpauthUri, generateTotpSecret, hotp, verifyTotp } from './totp';

//? RFC 4226 Appendix D + RFC 6238 Appendix B use this ASCII secret.
const RFC_SECRET_ASCII = '12345678901234567890';
const RFC_KEY = Buffer.from(RFC_SECRET_ASCII);
const RFC_SECRET_BASE32 = base32Encode(RFC_KEY);

describe('hotp — RFC 4226 Appendix D test vectors', () => {
  const VECTORS = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
  it.each(VECTORS.map((code, counter) => [counter, code]))('counter %i → %s', (counter, code) => {
    expect(hotp(RFC_KEY, counter as number)).toBe(code);
  });
});

describe('verifyTotp — RFC 6238 Appendix B test vectors (SHA-1, 8 digits)', () => {
  //? [unix seconds, expected 8-digit code]
  const VECTORS: [number, string][] = [
    [59, '94287082'],
    [1_111_111_109, '07081804'],
    [1_111_111_111, '14050471'],
    [1_234_567_890, '89005924'],
    [2_000_000_000, '69279037'],
    [20_000_000_000, '65353130'],
  ];
  it.each(VECTORS)('T=%i → %s', (seconds, code) => {
    const result = verifyTotp({ secret: RFC_SECRET_BASE32, code, window: 0, timestampMs: seconds * 1000 });
    expect(result.valid).toBe(true);
    expect(result.timestep).toBe(Math.floor(seconds / 30));
  });

  it('rejects the right code at the wrong time (outside the window)', () => {
    const result = verifyTotp({ secret: RFC_SECRET_BASE32, code: '94287082', window: 1, timestampMs: 1_111_111_111_000 });
    expect(result.valid).toBe(false);
    expect(result.timestep).toBeNull();
  });

  it('accepts the PREVIOUS step code inside the default drift window', () => {
    //? T=59 is step 1; at T=89 (step 2) the step-1 code must still verify.
    const result = verifyTotp({ secret: RFC_SECRET_BASE32, code: '94287082', timestampMs: 89 * 1000 });
    expect(result.valid).toBe(true);
    expect(result.timestep).toBe(1);
  });

  it('returns the MATCHED timestep so callers can enforce single-use (replay protection)', () => {
    const now = 1_111_111_111_000;
    const current = verifyTotp({ secret: RFC_SECRET_BASE32, code: '14050471', timestampMs: now });
    expect(current.timestep).toBe(Math.floor(1_111_111_111 / 30));
  });

  it('rejects malformed codes and secrets without throwing', () => {
    expect(verifyTotp({ secret: RFC_SECRET_BASE32, code: 'abc123' }).valid).toBe(false);
    expect(verifyTotp({ secret: RFC_SECRET_BASE32, code: '12345' }).valid).toBe(false); //? 5 digits
    expect(verifyTotp({ secret: '!!not-base32!!', code: '123456' }).valid).toBe(false);
    expect(verifyTotp({ secret: '', code: '123456' }).valid).toBe(false);
  });

  it('tolerates whitespace around the entered code', () => {
    const result = verifyTotp({ secret: RFC_SECRET_BASE32, code: ' 94287082 ', window: 0, timestampMs: 59_000 });
    expect(result.valid).toBe(true);
  });

  it('caps the drift window (a huge window must not be honored)', () => {
    //? Step-1 code at step 100 with an absurd window: capped to ±4 → invalid.
    const result = verifyTotp({ secret: RFC_SECRET_BASE32, code: '94287082', window: 10_000, timestampMs: 3000 * 1000 });
    expect(result.valid).toBe(false);
  });
});

describe('base32 round-trip', () => {
  it('encodes the RFC secret to the canonical base32 form', () => {
    expect(RFC_SECRET_BASE32).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  });

  it('decodes case-insensitively and ignores spaces + padding', () => {
    expect(base32Decode('gezd gnbv gy3t qojq gezd gnbv gy3t qojq==')?.toString()).toBe(RFC_SECRET_ASCII);
  });

  it('returns null on non-alphabet characters and empty input', () => {
    expect(base32Decode('1189!!')).toBeNull(); //? 1, 8, 9 are not in the RFC 4648 alphabet
    expect(base32Decode('')).toBeNull();
  });

  it('round-trips random buffers of every length 1..32', () => {
    for (let length = 1; length <= 32; length++) {
      const input = Buffer.from(Array.from({ length }, (_, index) => (index * 37 + length) % 256));
      expect(base32Decode(base32Encode(input))?.equals(input)).toBe(true);
    }
  });
});

describe('generateTotpSecret + buildOtpauthUri', () => {
  it('generates a 160-bit secret (32 base32 chars) that decodes to 20 bytes', () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(secret)?.length).toBe(20);
  });

  it('generates unique secrets', () => {
    expect(generateTotpSecret()).not.toBe(generateTotpSecret());
  });

  it('builds the provisioning URI authenticator apps expect', () => {
    const uri = buildOtpauthUri({ secret: 'ABC234', accountName: 'user@example.com', issuer: 'My App' });
    expect(uri).toBe('otpauth://totp/My%20App:user%40example.com?secret=ABC234&issuer=My+App&algorithm=SHA1&digits=6&period=30');
  });

  it('a generated secret verifies its own current code end-to-end', () => {
    const secret = generateTotpSecret();
    const key = base32Decode(secret);
    if (!key) throw new Error('generated secret must decode');
    const now = 1_700_000_000_000;
    const code = hotp(key, Math.floor(now / 1000 / 30));
    expect(verifyTotp({ secret, code, timestampMs: now }).valid).toBe(true);
  });
});
