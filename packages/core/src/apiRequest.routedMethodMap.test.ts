import { beforeEach, describe, expect, it } from 'vitest';

import { registerApiMethodMap } from './apiMethodMapRegistry';
import { resolveApiRequestHttpMethod } from './apiRequest';

describe('apiRequest routed HTTP method map', () => {
  beforeEach(() => {
    registerApiMethodMap({
      system: {
        organization: { v1: 'GET' },
      },
    });
  });

  it('uses the generated GET method for a route name whose prefix would infer POST', () => {
    expect(resolveApiRequestHttpMethod('system/organization', 'v1')).toBe('GET');
  });

  it('fails closed for a routed route missing from the generated method map', () => {
    expect(resolveApiRequestHttpMethod('system/unknownAction', 'v1')).toBeUndefined();
  });
});
