import { describe, it, expect } from 'vitest';

import { validateRequest } from './validateRequest';
import type { AuthProps, BaseSessionLayout } from './sessionTypes';

const user: BaseSessionLayout = { id: 'u1', token: 't', admin: true };

describe('validateRequest null-safety (api F4 / SYNC-02-root)', () => {
  it('succeeds with no additional[] even when user is undefined', () => {
    const auth: AuthProps = { login: false };
    expect(validateRequest({ auth, user: undefined }).status).toBe('success');
  });

  it('succeeds with no additional[] even when user is null', () => {
    const auth: AuthProps = { login: false };
    expect(validateRequest({ auth, user: null }).status).toBe('success');
  });

  it('succeeds with an EMPTY additional[] when user is null (prod/generated map normalizes auth to additional: [])', () => {
    const auth: AuthProps = { login: false, additional: [] };
    expect(validateRequest({ auth, user: null }).status).toBe('success');
    expect(validateRequest({ auth, user: undefined }).status).toBe('success');
  });

  it('does NOT throw and forbids when additional[] is present but user is null', () => {
    const auth: AuthProps = { login: true, additional: [{ key: 'admin', value: true }] };
    expect(() => validateRequest({ auth, user: null })).not.toThrow();
    const result = validateRequest({ auth, user: null });
    expect(result.status).toBe('error');
    expect(result.errorCode).toBe('auth.forbidden');
    expect(result.httpStatus).toBe(403);
  });

  it('does NOT throw and forbids when additional[] is present but user is undefined', () => {
    const auth: AuthProps = { login: true, additional: [{ key: 'admin', value: true }] };
    expect(() => validateRequest({ auth, user: undefined })).not.toThrow();
    expect(validateRequest({ auth, user: undefined }).status).toBe('error');
  });

  it('still evaluates additional[] predicates against a present user', () => {
    const auth: AuthProps = { login: true, additional: [{ key: 'admin', value: true }] };
    expect(validateRequest({ auth, user }).status).toBe('success');
  });
});
