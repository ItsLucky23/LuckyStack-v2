import { afterEach, describe, expect, it } from 'vitest';
import { registerCsrfConfig, resetCsrfConfigForTests } from '@luckystack/core';
import { buildHookSafeHeaders } from './httpHandler';

//? Finding 087: the `preHttpRequest` header subset must drop the CONFIGURED
//? CSRF header (not only the default 'x-csrf-token') and proxy credentials.
describe('buildHookSafeHeaders', () => {
  afterEach(() => {
    resetCsrfConfigForTests();
  });

  it('drops a renamed CSRF header and proxy-authorization', () => {
    registerCsrfConfig({ headerName: 'X-XSRF-Token' });
    const safe = buildHookSafeHeaders({
      'x-xsrf-token': 'session-bound',
      'proxy-authorization': 'Basic abc',
      authorization: 'Bearer t',
      cookie: 'token=t',
      'user-agent': 'ua',
    });
    expect(safe).toEqual({ 'user-agent': 'ua' });
  });

  it('still drops the default x-csrf-token header', () => {
    expect(buildHookSafeHeaders({ 'x-csrf-token': 'session-bound', accept: '*/*' })).toEqual({ accept: '*/*' });
  });
});
