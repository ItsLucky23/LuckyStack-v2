import { describe, it, expect } from 'vitest';
import { deriveOrm, deriveState, type StateInputs } from './state';

const base = (over: Partial<StateInputs> = {}): StateInputs => ({
  hasPackage: () => false,
  declaredKeys: new Set<string>(),
  ...over,
});

describe('deriveOrm — data-layer detection (ADR 0020)', () => {
  it('manifest value wins over dependency inference', () => {
    expect(deriveOrm({ hasPackage: (p) => p === '@prisma/client', scaffoldOrm: 'drizzle' })).toBe('drizzle');
    expect(deriveOrm({ hasPackage: () => false, scaffoldOrm: 'mikro-orm' })).toBe('mikro-orm');
    expect(deriveOrm({ hasPackage: (p) => p === 'drizzle-orm', scaffoldOrm: 'none' })).toBe('none');
  });

  it('falls back to dependency inference (prisma > drizzle > mikro-orm > none)', () => {
    expect(deriveOrm({ hasPackage: (p) => p === '@prisma/client' })).toBe('prisma');
    expect(deriveOrm({ hasPackage: (p) => p === 'drizzle-orm' })).toBe('drizzle');
    expect(deriveOrm({ hasPackage: (p) => p === '@mikro-orm/core' })).toBe('mikro-orm');
    expect(deriveOrm({ hasPackage: () => false })).toBe('none');
  });

  it('ignores an invalid manifest value', () => {
    expect(deriveOrm({ hasPackage: (p) => p === '@prisma/client', scaffoldOrm: 'hibernate' })).toBe('prisma');
    expect(deriveOrm({ hasPackage: () => false, scaffoldOrm: 42 })).toBe('none');
  });

  it('lands on deriveState.orm', () => {
    expect(deriveState(base({ scaffoldOrm: 'drizzle' })).orm).toBe('drizzle');
    expect(deriveState(base()).orm).toBe('none');
  });
});

describe('deriveState — authMode', () => {
  it('none when no login dep and no login UI', () => {
    expect(deriveState(base()).authMode).toBe('none');
  });

  it('credentials when login is installed but no OAuth keys', () => {
    expect(deriveState(base({ hasPackage: (p) => p === '@luckystack/login' })).authMode).toBe('credentials');
  });

  it('none when an OAuth key is declared but the login package is NOT installed (stale)', () => {
    const state = deriveState(base({ declaredKeys: new Set(['DEV_GOOGLE_CLIENT_ID']) }));
    expect(state.authMode).toBe('none');
    expect(state.oauthProviders).toEqual([]);
  });

  it('credentials+oauth when login + an OAuth id key is declared', () => {
    const state = deriveState(base({
      hasPackage: (p) => p === '@luckystack/login',
      declaredKeys: new Set(['DEV_GOOGLE_CLIENT_ID', 'GITHUB_CLIENT_ID']),
    }));
    expect(state.authMode).toBe('credentials+oauth');
    expect(state.oauthProviders.toSorted()).toEqual(['github', 'google']);
  });
});

describe('deriveState — email (requires @luckystack/email installed)', () => {
  const withEmail = (keys: string[]): ReturnType<typeof deriveState> =>
    deriveState(base({ hasPackage: (p) => p === '@luckystack/email', declaredKeys: new Set(keys) }));
  it('resend when email pkg + RESEND_API_KEY', () => {
    expect(withEmail(['RESEND_API_KEY']).email).toBe('resend');
  });
  it('smtp when email pkg + SMTP_HOST', () => {
    expect(withEmail(['SMTP_HOST']).email).toBe('smtp');
  });
  it('console when email pkg installed but no adapter key', () => {
    expect(withEmail([]).email).toBe('console');
  });
  it('none when the adapter key is present but the package is NOT (stale key)', () => {
    expect(deriveState(base({ declaredKeys: new Set(['RESEND_API_KEY']) })).email).toBe('none');
  });
  it('none otherwise', () => {
    expect(deriveState(base()).email).toBe('none');
  });
});

describe('deriveState — monitoring (requires @luckystack/error-tracking installed)', () => {
  const withEt = (keys: string[]): ReturnType<typeof deriveState> =>
    deriveState(base({ hasPackage: (p) => p === '@luckystack/error-tracking', declaredKeys: new Set(keys) }));
  it('sentry when error-tracking pkg + SENTRY_DSN', () => {
    expect(withEt(['SENTRY_DSN']).monitoring).toBe('sentry');
  });
  it('posthog when error-tracking pkg + POSTHOG_KEY', () => {
    expect(withEt(['POSTHOG_KEY']).monitoring).toBe('posthog');
  });
  it('none when the backend key is present but the package is NOT (stale key)', () => {
    expect(deriveState(base({ declaredKeys: new Set(['SENTRY_DSN']) })).monitoring).toBe('none');
  });
  it('none when no backend key declared', () => {
    expect(deriveState(base()).monitoring).toBe('none');
  });
});

describe('deriveState — packages map', () => {
  it('reflects installed registry packages', () => {
    const state = deriveState(base({ hasPackage: (p) => p === '@luckystack/presence' }));
    expect(state.packages.presence).toBe(true);
    expect(state.packages['docs-ui']).toBe(false);
  });
});
