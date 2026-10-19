import { describe, expect, it } from 'vitest';
import { isRedactedLogKey } from '@luckystack/core';

//? Importing the package entry registers the 2FA secrets this package receives
//? with core's log redaction (finding 092). The generic `code` must stay
//? readable: it also names error and country codes in unrelated logs.

describe('login package entry: redacted log keys', () => {
  it('masks the 2FA secrets but not a bare code', async () => {
    await import('./index');

    expect(isRedactedLogKey('recoveryCode')).toBe(true);
    expect(isRedactedLogKey('totp')).toBe(true);
    expect(isRedactedLogKey('totpCode')).toBe(true);
    expect(isRedactedLogKey('totp_code')).toBe(true);
    expect(isRedactedLogKey('code')).toBe(false);
  });
});
