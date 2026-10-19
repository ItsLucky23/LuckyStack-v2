//? Active-language state for `TranslationProvider`. The registered language
//? source (typically `session.language`) is polled; `useUpdateLanguage` sets a
//? local override on top of it (the settings page's live preview). The override
//? wins until the SOURCE itself changes, so a preview is not reverted by the
//? next poll, and a saved language (or a session from elsewhere) still applies.

import type { SetStateAction } from 'react';

export interface LanguageState {
  source: string;
  override: string | null;
}

export const activeLanguage = (state: LanguageState): string => state.override ?? state.source;

export const applyLanguageSource = (state: LanguageState, next: string): LanguageState =>
  next === state.source ? state : { source: next, override: null };

export const applyLanguageOverride = (state: LanguageState, value: SetStateAction<string>): LanguageState => ({
  ...state,
  override: typeof value === 'function' ? value(activeLanguage(state)) : value,
});
