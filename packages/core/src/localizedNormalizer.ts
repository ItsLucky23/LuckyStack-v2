import type {
  ErrorParam,
  ErrorResponseInput,
  NormalizedErrorResponse,
} from './responseNormalizer';
import {
  defaultHttpStatusForResponse,
  normalizeErrorResponseCore,
} from './responseNormalizer';

//? Factory that turns a project-provided translate function into the full
//? normalizer surface the framework packages need.
//?
//? Before this split, `@luckystack/api` and `@luckystack/sync` imported
//? `normalizeErrorResponse` from `server/utils/responseNormalizer` via deep
//? relative paths — a framework-into-project reach-in. Now the project
//? registers a normalizer on boot and framework code consumes it through
//? the singleton below.

export type LanguageCode = string;

export interface TranslateInput {
  language: LanguageCode;
  key: string;
  params?: ErrorParam[];
}

export type TranslateFunction = (input: TranslateInput) => string;

export interface NormalizeErrorResponseInput {
  response: ErrorResponseInput;
  preferredLocale?: string | null;
  userLanguage?: string | null;
  fallbackHttpStatus?: number;
}

export interface LocalizedNormalizer {
  normalizeErrorResponse: (input: NormalizeErrorResponseInput) => NormalizedErrorResponse;
  resolveErrorMessage: (input: {
    errorCode: string;
    errorParams?: ErrorParam[];
    preferredLocale?: string | null;
    userLanguage?: string | null;
  }) => string;
  extractLanguageFromHeader: (header?: string | string[]) => LanguageCode | null;
}

export interface CreateLocalizedNormalizerInput {
  translate: TranslateFunction;
  /**
   * Language the framework falls back to when the caller provides no
   * language hints. Defaults to 'en'.
   */
  defaultLanguage?: LanguageCode;
  /**
   * Decide whether a given string is an acceptable language code. Defaults
   * to accepting any non-empty short-form code (ISO 639-1 style). Projects
   * that only support a closed set should pass a narrower predicate.
   */
  isSupportedLanguage?: (code: string) => boolean;
}

const normalizeLanguageCode = (
  language: string | null | undefined,
  isSupported: (code: string) => boolean,
): LanguageCode | null => {
  if (!language) return null;
  const short = language.toLowerCase().split('-')[0];
  if (!short) return null;
  return isSupported(short) ? short : null;
};

export const createLocalizedNormalizer = (
  input: CreateLocalizedNormalizerInput,
): LocalizedNormalizer => {
  const defaultLanguage = input.defaultLanguage ?? 'en';
  const isSupported = input.isSupportedLanguage ?? (() => true);

  const extractLanguageFromHeader = (header?: string | string[]): LanguageCode | null => {
    if (!header) return null;
    const normalized = Array.isArray(header) ? header.join(',') : header;

    const candidates = normalized
      .split(',')
      .map(part => part.trim().split(';')[0])
      .filter(Boolean);

    for (const candidate of candidates) {
      const language = normalizeLanguageCode(candidate, isSupported);
      if (language) return language;
    }
    return null;
  };

  const resolveLanguage = ({
    preferredLocale,
    userLanguage,
  }: {
    preferredLocale?: string | null;
    userLanguage?: string | null;
  }): LanguageCode => {
    return (
      normalizeLanguageCode(userLanguage, isSupported)
      ?? normalizeLanguageCode(preferredLocale, isSupported)
      ?? defaultLanguage
    );
  };

  const resolveErrorMessage = ({
    errorCode,
    errorParams,
    preferredLocale,
    userLanguage,
  }: {
    errorCode: string;
    errorParams?: ErrorParam[];
    preferredLocale?: string | null;
    userLanguage?: string | null;
  }): string => {
    const language = resolveLanguage({ preferredLocale, userLanguage });
    return input.translate({ language, key: errorCode, params: errorParams });
  };

  const normalizeErrorResponse = ({
    response,
    preferredLocale,
    userLanguage,
    fallbackHttpStatus,
  }: NormalizeErrorResponseInput): NormalizedErrorResponse => {
    const normalized = normalizeErrorResponseCore({
      response,
      fallbackHttpStatus,
      resolveMessage: ({ errorCode, errorParams }) => resolveErrorMessage({
        errorCode,
        errorParams,
        preferredLocale,
        userLanguage,
      }),
    });

    return {
      ...normalized,
      httpStatus: defaultHttpStatusForResponse({
        status: 'error',
        explicitHttpStatus: normalized.httpStatus,
      }),
    };
  };

  return { normalizeErrorResponse, resolveErrorMessage, extractLanguageFromHeader };
};

//? Module-level singleton so framework packages can resolve the project's
//? translate wiring without deep-relative imports. The server registers its
//? normalizer on boot; tests and tooling fall back to the identity default
//? (returns the errorCode key unchanged as the message).
const identityNormalizer: LocalizedNormalizer = createLocalizedNormalizer({
  translate: ({ key }) => key,
});

let activeNormalizer: LocalizedNormalizer = identityNormalizer;

export const registerLocalizedNormalizer = (normalizer: LocalizedNormalizer): void => {
  activeNormalizer = normalizer;
};

export const getLocalizedNormalizer = (): LocalizedNormalizer => activeNormalizer;

//? Delegating wrappers for consumers (@luckystack/api, @luckystack/sync, etc.)
//? that want import-time-safe references. The project registers its
//? normalizer on boot; these functions always resolve through the singleton
//? at call time, so there's no import-order fragility.
export const normalizeErrorResponse = (
  input: NormalizeErrorResponseInput,
): NormalizedErrorResponse => activeNormalizer.normalizeErrorResponse(input);

export const resolveErrorMessage = (input: {
  errorCode: string;
  errorParams?: ErrorParam[];
  preferredLocale?: string | null;
  userLanguage?: string | null;
}): string => activeNormalizer.resolveErrorMessage(input);

export const extractLanguageFromHeader = (header?: string | string[]): LanguageCode | null =>
  activeNormalizer.extractLanguageFromHeader(header);
