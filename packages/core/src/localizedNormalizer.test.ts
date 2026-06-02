import { describe, it, expect } from 'vitest';

import {
  createLocalizedNormalizer,
  getLocalizedNormalizer,
  isLocalizedNormalizerRegistered,
  registerLocalizedNormalizer,
  normalizeErrorResponse,
  resolveErrorMessage,
  extractLanguageFromHeader,
} from './localizedNormalizer';

describe('createLocalizedNormalizer — extractLanguageFromHeader', () => {
  const normalizer = createLocalizedNormalizer({ translate: ({ key }) => key });

  it('returns null for missing or empty headers', () => {
    expect(normalizer.extractLanguageFromHeader()).toBeNull();
    expect(normalizer.extractLanguageFromHeader('')).toBeNull();
  });

  it('extracts the short-form code from a single Accept-Language value', () => {
    expect(normalizer.extractLanguageFromHeader('en-US')).toBe('en');
  });

  it('picks the first acceptable candidate from a weighted list', () => {
    expect(normalizer.extractLanguageFromHeader('fr-CA,en;q=0.8')).toBe('fr');
  });

  it('joins array headers before parsing', () => {
    expect(normalizer.extractLanguageFromHeader(['de-DE', 'en'])).toBe('de');
  });

  it('honours a narrow isSupportedLanguage predicate, skipping unsupported codes', () => {
    const narrow = createLocalizedNormalizer({
      translate: ({ key }) => key,
      isSupportedLanguage: (code) => code === 'en',
    });
    // fr is skipped, en is accepted.
    expect(narrow.extractLanguageFromHeader('fr-FR,en-US')).toBe('en');
    // nothing supported -> null.
    expect(narrow.extractLanguageFromHeader('fr-FR,de-DE')).toBeNull();
  });
});

describe('createLocalizedNormalizer — resolveErrorMessage language resolution', () => {
  it('prefers userLanguage, then preferredLocale, then the default language', () => {
    const seen: string[] = [];
    const normalizer = createLocalizedNormalizer({
      translate: ({ language, key }) => {
        seen.push(language);
        return `${language}:${key}`;
      },
      defaultLanguage: 'en',
    });

    expect(
      normalizer.resolveErrorMessage({ errorCode: 'x', userLanguage: 'nl-NL', preferredLocale: 'de' }),
    ).toBe('nl:x');

    expect(
      normalizer.resolveErrorMessage({ errorCode: 'x', preferredLocale: 'de-DE' }),
    ).toBe('de:x');

    expect(normalizer.resolveErrorMessage({ errorCode: 'x' })).toBe('en:x');
  });
});

describe('createLocalizedNormalizer — normalizeErrorResponse', () => {
  const normalizer = createLocalizedNormalizer({
    translate: ({ key, params }) =>
      params?.length ? `${key}|${String(params[0]?.value)}` : key,
  });

  it('produces a localized error envelope with an httpStatus default of 400', () => {
    const result = normalizer.normalizeErrorResponse({
      response: { errorCode: 'auth.required' },
    });
    expect(result.status).toBe('error');
    expect(result.errorCode).toBe('auth.required');
    expect(result.message).toBe('auth.required');
    expect(result.httpStatus).toBe(400);
  });

  it('honours an explicit httpStatus from the response', () => {
    const result = normalizer.normalizeErrorResponse({
      response: { errorCode: 'rate.limited', httpStatus: 429 },
    });
    expect(result.httpStatus).toBe(429);
  });

  it('passes errorParams through to the translate function', () => {
    const result = normalizer.normalizeErrorResponse({
      response: { errorCode: 'greet', errorParams: [{ key: 'name', value: 'Sam' }] },
    });
    expect(result.message).toBe('greet|Sam');
  });
});

describe('localizedNormalizer singleton', () => {
  it('uses the identity normalizer by default (errorCode passed through as message)', () => {
    // The module-level default returns the key unchanged.
    expect(resolveErrorMessage({ errorCode: 'untouched.code' })).toBe('untouched.code');
    expect(extractLanguageFromHeader('en-GB')).toBe('en');
  });

  it('registers a custom normalizer and routes the delegating wrappers through it', () => {
    const custom = createLocalizedNormalizer({
      translate: ({ key }) => `translated:${key}`,
    });
    registerLocalizedNormalizer(custom);

    expect(isLocalizedNormalizerRegistered()).toBe(true);
    expect(getLocalizedNormalizer()).toBe(custom);
    expect(resolveErrorMessage({ errorCode: 'hello' })).toBe('translated:hello');

    const normalized = normalizeErrorResponse({ response: { errorCode: 'hello' } });
    expect(normalized.message).toBe('translated:hello');
    expect(normalized.httpStatus).toBe(400);
  });
});
