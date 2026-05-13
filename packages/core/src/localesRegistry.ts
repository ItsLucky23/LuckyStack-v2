//? Locales registry — lets the framework's TranslationProvider + notify
//? read the consumer's translation JSON files without baking them into the
//? package. Consumer overlay: `luckystack/i18n/locales.ts` calls
//? `registerLocales({ en: enJson, nl: nlJson, ... })`.
//?
//? Language source: a separate registry — `registerLanguageSource(fn)` —
//? lets the consumer wire up where the active language comes from
//? (typically the SessionProvider's current `session.language`). When no
//? source is registered, the framework falls back to
//? `getProjectConfig().defaultLanguage`.

import { getProjectConfig } from './projectConfig';

export type LocalesMap = Record<string, unknown>;
export type LanguageSource = () => string | null | undefined;

let activeLocales: LocalesMap = {};
let activeLanguageSource: LanguageSource | null = null;

export const registerLocales = (locales: LocalesMap): void => {
  activeLocales = locales;
};

export const getRegisteredLocales = (): LocalesMap => activeLocales;

export const getDefaultLocale = (): string => getProjectConfig().defaultLanguage || 'en';

export const registerLanguageSource = (fn: LanguageSource): void => {
  activeLanguageSource = fn;
};

export const getActiveLanguage = (): string => {
  if (activeLanguageSource) {
    const lang = activeLanguageSource();
    if (typeof lang === 'string' && lang.length > 0) return lang;
  }
  return getDefaultLocale();
};

//? Lookup a language's translation tree by code. Falls back to default
//? language when the code isn't registered. Used by TranslationProvider
//? + notify to resolve the active translations.
export const getLocaleByCode = (code: string): unknown => {
  if (code in activeLocales) return activeLocales[code];
  const fallback = getDefaultLocale();
  if (fallback in activeLocales) return activeLocales[fallback];
  return {};
};
