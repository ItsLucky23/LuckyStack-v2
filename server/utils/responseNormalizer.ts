/* eslint-disable @typescript-eslint/no-unnecessary-condition */

import { defaultLanguage } from '../../config';
import fs from 'node:fs';
import path from 'node:path';
import deJson from '../../src/_locales/de.json';
import enJson from '../../src/_locales/en.json';
import frJson from '../../src/_locales/fr.json';
import nlJson from '../../src/_locales/nl.json';
import {
  ErrorParam,
  createLocalizedNormalizer,
  registerLocalizedNormalizer,
  registerLocaleReloader,
  tryCatch,
} from '@luckystack/core';
import { SRC_DIR } from './paths';

type LanguageCode = 'nl' | 'en' | 'de' | 'fr';
type TranslationRecord = Record<string, string | Record<string, unknown>>;

let translationsByLanguage: Record<LanguageCode, TranslationRecord> = {
  nl: nlJson,
  en: enJson,
  de: deJson,
  fr: frJson,
};

const localePaths: Record<LanguageCode, string> = {
  nl: path.join(SRC_DIR, '_locales', 'nl.json'),
  en: path.join(SRC_DIR, '_locales', 'en.json'),
  de: path.join(SRC_DIR, '_locales', 'de.json'),
  fr: path.join(SRC_DIR, '_locales', 'fr.json'),
};

export const reloadLocaleTranslations = async () => {
  const nextTranslations: Record<LanguageCode, TranslationRecord> = { ...translationsByLanguage };

  for (const language of Object.keys(localePaths) as LanguageCode[]) {
    const [error, parsed] = await tryCatch(() => {
      const filePath = localePaths[language];
      const rawJson = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(rawJson) as TranslationRecord;
    });
    if (error || !parsed) {
      console.log(`Failed to reload locale ${language}:`, error, 'yellow');
      continue;
    }
    nextTranslations[language] = parsed;
  }

  translationsByLanguage = nextTranslations;
};

const SUPPORTED_LANGUAGES: LanguageCode[] = ['nl', 'en', 'de', 'fr'];
const isSupportedLanguage = (code: string): code is LanguageCode => {
  return (SUPPORTED_LANGUAGES as string[]).includes(code);
};

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
  const translationList = translationsByLanguage[resolvedLanguage] ?? translationsByLanguage.en;
  const parts = key.split('.');
  let result: unknown = translationList;

  for (const part of parts) {
    if (typeof result === 'object' && result !== null && part in result) {
      result = (result as Record<string, unknown>)[part];
    } else {
      return key;
    }
  }

  if (typeof result !== 'string') return key;
  if (!params || params.length === 0) return result;

  let finalResult = result;
  for (const param of params) {
    const regex = new RegExp(`{{${param.key}}}`, 'g');
    finalResult = finalResult.replace(regex, String(param.value));
  }

  return finalResult;
};

const projectNormalizer = createLocalizedNormalizer({
  translate,
  defaultLanguage: defaultLanguage ?? 'en',
  isSupportedLanguage,
});

//? Register as the framework-wide active normalizer so @luckystack/api,
//? @luckystack/sync, and any future framework package consuming
//? `getLocalizedNormalizer()` use project translations.
registerLocalizedNormalizer(projectNormalizer);

//? Lets `@luckystack/devkit`'s hot-reload watcher trigger a translations
//? refresh without taking a relative-path dependency on this file.
registerLocaleReloader(reloadLocaleTranslations);

export const { normalizeErrorResponse, resolveErrorMessage, extractLanguageFromHeader } = projectNormalizer;
export { defaultHttpStatusForResponse } from '@luckystack/core';
