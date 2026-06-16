import { describe, it, expect } from 'vitest';

import { inferHttpMethod, isMethodAllowed } from './httpApiUtils';

describe('inferHttpMethod', () => {
  it('maps get/fetch/list prefixes to GET', () => {
    expect(inferHttpMethod('getUserData')).toBe('GET');
    expect(inferHttpMethod('fetchProfile')).toBe('GET');
    expect(inferHttpMethod('listItems')).toBe('GET');
  });

  it('maps delete/remove to DELETE and update/edit/patch to PUT', () => {
    expect(inferHttpMethod('deleteAccount')).toBe('DELETE');
    expect(inferHttpMethod('removeMember')).toBe('DELETE');
    expect(inferHttpMethod('updateProfile')).toBe('PUT');
    expect(inferHttpMethod('editName')).toBe('PUT');
  });

  it('defaults to POST', () => {
    expect(inferHttpMethod('createUser')).toBe('POST');
    expect(inferHttpMethod('sendEmail')).toBe('POST');
  });
});

describe('isMethodAllowed', () => {
  it('allows only an exact method match', () => {
    expect(isMethodAllowed('GET', 'GET')).toBe(true);
    expect(isMethodAllowed('POST', 'GET')).toBe(false);
  });

  //? Regression (CORE-16): OPTIONS must NOT be treated as allowed, otherwise a
  //? method-locked route would execute on a CSRF-exempt preflight.
  it('does NOT treat OPTIONS as allowed', () => {
    expect(isMethodAllowed('OPTIONS', 'GET')).toBe(false);
    expect(isMethodAllowed('OPTIONS', 'POST')).toBe(false);
  });
});
