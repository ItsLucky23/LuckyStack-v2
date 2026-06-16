/* eslint-disable react-refresh/only-export-components */
//? Framework-owned translation provider. Reads the registered locales map
//? (consumer registers via `registerLocales({...})` in their overlay) and
//? the active language source (consumer registers via
//? `registerLanguageSource(fn)`, typically `() => session?.language`).
//? Default language falls back to `getProjectConfig().defaultLanguage`.

import { createContext, ReactNode, use, useEffect, useMemo, useState, Dispatch, SetStateAction } from 'react';
import {
  getActiveLanguage,
  getDefaultLocale,
  getLocaleByCode,
  getRegisteredLocales,
} from '../localesRegistry';

export type TranslationRecord = Record<string, unknown>;

interface TranslationContextValue {
  translations: TranslationRecord;
  setLanguage: Dispatch<SetStateAction<string>>;
}

const TranslationContext = createContext<TranslationContextValue | null>(null);

const resolveTranslations = (code: string): TranslationRecord => {
  const value = getLocaleByCode(code);
  if (value && typeof value === 'object') return value as TranslationRecord;
  return {};
};

export function TranslationProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<string>(() => getActiveLanguage());
  const translations = useMemo(() => resolveTranslations(language), [language]);

  //? Poll the registered language source so changes to session.language
  //? (or whatever the consumer wired) flip the active language without a
  //? full remount. Cheap: shallow string compare every ~250ms.
  useEffect(() => {
    const handle = window.setInterval(() => {
      const next = getActiveLanguage();
      if (next !== language) setLanguage(next);
    }, 250);
    return () => { window.clearInterval(handle); };
  }, [language]);

  const contextValue = useMemo(() => ({ translations, setLanguage }), [translations]);

  return (
    <TranslationContext value={contextValue}>
      {children}
    </TranslationContext>
  );
}

export function useTranslation() {
  const context = use(TranslationContext);
  if (!context) throw new Error('useTranslation must be used within a TranslationProvider');
  return context.translations;
}

export function useUpdateLanguage() {
  const context = use(TranslationContext);
  if (!context) throw new Error('useUpdateLanguage must be used within a TranslationProvider');
  return context.setLanguage;
}

export interface TranslateParam { key: string; value: string | number | boolean }

//? Resolve `a.b.c` style dot-notation keys in a translation tree. Returns
//? the key itself if it can't be resolved (so untranslated strings stand
//? out in the UI rather than vanishing). Supports `{{param}}` substitution.
export function translate({ translationList, key, params }: {
  translationList: TranslationRecord;
  key: unknown;
  params?: TranslateParam[];
}): string {
  if (typeof key !== 'string' || key.length === 0) return '';

  const parts = key.split('.');
  let result: unknown = translationList;
  for (const part of parts) {
    if (result && typeof result === 'object' && part in result) {
      result = (result as Record<string, unknown>)[part];
    } else {
      return key;
    }
  }
  if (typeof result !== 'string') return key;
  if (!Array.isArray(params) || params.length === 0) return result;

  let finalResult = result;
  for (const param of params) {
    if (!param.key) continue;
    //? Escape key before building the RegExp — a key containing regex
    //? meta-characters (e.g. `.`, `+`, `(`) would otherwise mis-substitute
    //? or cause ReDoS. Use a function-form replacer to prevent `$`-sequences
    //? in the translation value from being interpreted by String.prototype.replace.
    const escapedKey = param.key.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
    const regex = new RegExp(`\\{\\{${escapedKey}\\}\\}`, 'g');
    const replacement = String(param.value);
    finalResult = finalResult.replace(regex, () => replacement);
  }
  return finalResult;
}

//? Tiny convenience hook for the common case: pass `{ key, params }` and
//? get the resolved string back.
export const useTranslator = () => {
  const translations = useTranslation();
  return ({ key, params }: { key: string; params?: TranslateParam[] }) =>
    translate({ translationList: translations, key, params });
};

//? Re-export helpers from the registry so consumers have a single import
//? point for translation customization.
export { getActiveLanguage, getDefaultLocale, getRegisteredLocales };
