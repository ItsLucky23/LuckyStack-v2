import { describe, it, expect } from 'vitest';
import { deriveState, type StateInputs } from './state';

const base = (over: Partial<StateInputs> = {}): StateInputs => ({
  hasPackage: () => false,
  hasLoginUi: false,
  declaredKeys: new Set<string>(),
  ...over,
});

describe('deriveState — authMode', () => {
  it('none when no login dep and no login UI', () => {
    expect(deriveState(base()).authMode).toBe('none');
  });

  it('credentials when login is installed but no OAuth keys', () => {
    expect(deriveState(base({ hasPackage: (p) => p === '@luckystack/login' })).authMode).toBe('credentials');
  });

  it('credentials when only the login UI is present (no dep yet)', () => {
    expect(deriveState(base({ hasLoginUi: true })).authMode).toBe('credentials');
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

describe('deriveState — email', () => {
  it('resend when RESEND_API_KEY declared', () => {
    expect(deriveState(base({ declaredKeys: new Set(['RESEND_API_KEY']) })).email).toBe('resend');
  });
  it('smtp when SMTP_HOST declared', () => {
    expect(deriveState(base({ declaredKeys: new Set(['SMTP_HOST']) })).email).toBe('smtp');
  });
  it('console when @luckystack/email installed but no adapter key', () => {
    expect(deriveState(base({ hasPackage: (p) => p === '@luckystack/email' })).email).toBe('console');
  });
  it('none otherwise', () => {
    expect(deriveState(base()).email).toBe('none');
  });
});

describe('deriveState — monitoring', () => {
  it('sentry when SENTRY_DSN declared', () => {
    expect(deriveState(base({ declaredKeys: new Set(['SENTRY_DSN']) })).monitoring).toBe('sentry');
  });
  it('posthog when POSTHOG_KEY declared', () => {
    expect(deriveState(base({ declaredKeys: new Set(['POSTHOG_KEY']) })).monitoring).toBe('posthog');
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
