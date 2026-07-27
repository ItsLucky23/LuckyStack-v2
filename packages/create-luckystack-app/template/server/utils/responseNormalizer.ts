//? Server-side translation-backed error normalizer. Framework packages resolve
//? this registration at runtime, keeping API/sync error envelopes localized.

import { defaultLanguage } from '../../config';
import deJson from '../../src/_locales/de.json';
import enJson from '../../src/_locales/en.json';
import frJson from '../../src/_locales/fr.json';
import nlJson from '../../src/_locales/nl.json';
import {
  createLocalizedNormalizer,
  registerLocalizedNormalizer,
  type ErrorParam,
} from '@luckystack/core';

type LanguageCode = 'nl' | 'en' | 'de' | 'fr';
type TranslationRecord = Record<string, string | Record<string, unknown>>;

const translations: Record<LanguageCode, TranslationRecord> = {
  nl: nlJson,
  en: enJson,
  de: deJson,
  fr: frJson,
};

const supportedLanguages: readonly LanguageCode[] = ['nl', 'en', 'de', 'fr'];
const isSupportedLanguage = (code: string): code is LanguageCode =>
  supportedLanguages.includes(code as LanguageCode);

const translate = ({
  language,
  key,
  params,
}: {
  language: string;
  key: string;
  params?: ErrorParam[];
}): string => {
  const resolvedLanguage = isSupportedLanguage(language) ? language : 'en';
  let result: unknown = translations[resolvedLanguage];
  for (const part of key.split('.')) {
    if (typeof result !== 'object' || result === null || !(part in result)) return key;
    result = (result as Record<string, unknown>)[part];
  }
  if (typeof result !== 'string') return key;
  for (const param of params ?? []) {
    result = result.replaceAll(`{{${param.key}}}`, () => String(param.value));
  }
  return result;
};

registerLocalizedNormalizer(createLocalizedNormalizer({
  translate,
  defaultLanguage: defaultLanguage ?? 'en',
  isSupportedLanguage,
}));
