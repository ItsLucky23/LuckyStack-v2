import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearOriginExemptPaths,
  getOriginExemptPaths,
  isOriginExemptPath,
  registerOriginExemptPath,
} from './originExemptRegistry';

describe('originExemptRegistry', () => {
  beforeEach(() => {
    clearOriginExemptPaths();
  });

  it('starts empty — nothing is exempt by default (fail-closed)', () => {
    expect(getOriginExemptPaths()).toHaveLength(0);
    expect(isOriginExemptPath('/webhooks/gitlab')).toBe(false);
    expect(isOriginExemptPath('/api/examples/foo')).toBe(false);
  });

  it('matches a registered prefix and only that prefix', () => {
    registerOriginExemptPath({ pathPrefix: '/webhooks/' });
    expect(isOriginExemptPath('/webhooks/gitlab')).toBe(true);
    expect(isOriginExemptPath('/webhooks/stripe/events')).toBe(true);
    //? Critically: registering a webhook prefix must NOT exempt framework routes.
    expect(isOriginExemptPath('/api/examples/foo')).toBe(false);
    expect(isOriginExemptPath('/auth/api/credentials')).toBe(false);
    expect(isOriginExemptPath('/sync/x')).toBe(false);
  });

  it('is a prefix match, not equality', () => {
    registerOriginExemptPath({ pathPrefix: '/webhooks/gitlab' });
    expect(isOriginExemptPath('/webhooks/gitlab')).toBe(true);
    expect(isOriginExemptPath('/webhooks/gitlab/merge')).toBe(true);
    expect(isOriginExemptPath('/webhooks/stripe')).toBe(false);
  });

  it('supports multiple registered prefixes', () => {
    registerOriginExemptPath({ pathPrefix: '/webhooks/gitlab' });
    registerOriginExemptPath({ pathPrefix: '/hooks/stripe' });
    expect(getOriginExemptPaths()).toHaveLength(2);
    expect(isOriginExemptPath('/webhooks/gitlab')).toBe(true);
    expect(isOriginExemptPath('/hooks/stripe')).toBe(true);
    expect(isOriginExemptPath('/other')).toBe(false);
  });

  it('clear restores the fail-closed default', () => {
    registerOriginExemptPath({ pathPrefix: '/webhooks/' });
    clearOriginExemptPaths();
    expect(getOriginExemptPaths()).toHaveLength(0);
    expect(isOriginExemptPath('/webhooks/gitlab')).toBe(false);
  });
});
