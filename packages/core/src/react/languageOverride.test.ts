import { describe, expect, it } from 'vitest';

import { activeLanguage, applyLanguageOverride, applyLanguageSource, type LanguageState } from './languageOverride';

describe('TranslationProvider language override', () => {
  it('keeps a useUpdateLanguage preview while the polled source is unchanged', () => {
    let state: LanguageState = { source: 'en', override: null };
    state = applyLanguageOverride(state, 'nl');

    //? Several 250 ms polls of an unchanged session language.
    state = applyLanguageSource(state, 'en');
    state = applyLanguageSource(state, 'en');

    expect(activeLanguage(state)).toBe('nl');
  });

  it('drops the override once the source itself changes', () => {
    let state: LanguageState = { source: 'en', override: 'nl' };
    state = applyLanguageSource(state, 'de');

    expect(state).toEqual({ source: 'de', override: null });
    expect(activeLanguage(state)).toBe('de');
  });

  it('returns the same state object for an unchanged source so React skips the render', () => {
    const state: LanguageState = { source: 'en', override: 'nl' };
    expect(applyLanguageSource(state, 'en')).toBe(state);
  });

  it('resolves a functional update against the active language', () => {
    const state: LanguageState = { source: 'en', override: 'nl' };
    expect(activeLanguage(applyLanguageOverride(state, (previous) => `${previous}-x`))).toBe('nl-x');
  });
});
