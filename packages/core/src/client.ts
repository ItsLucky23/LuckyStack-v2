//? Client-side (browser-safe) surface of @luckystack/core.
//? Kept separate from `./index.ts` because the server barrel re-exports
//? Node-API modules (paths.ts, db.ts, redis.ts) that must never enter a
//? Vite client bundle.
//?
//? This file aggregates everything `@luckystack/sync/client` and project
//? client code may need so consumers can `import ... from '@luckystack/core/client'`
//? instead of reaching into specific source files via relative paths.

export { apiRequest } from './apiRequest';
export type { ApiStreamEvent } from './apiRequest';

export {
  getProjectConfig,
  registerProjectConfig,
  isProjectConfigRegistered,
} from './projectConfig';
export type {
  ProjectConfig,
  AppConfig,
  LoggingConfig,
  RateLimitingConfig,
  SessionConfig,
} from './projectConfig';

export { notify, registerNotifier, getNotifier } from './notifier';
export type { Notifier, NotifyInput, NotifyParam } from './notifier';

export {
  socket,
  setSocket,
  incrementResponseIndex,
  waitForSocket,
} from './socketState';

export {
  isOnline,
  enqueueApiRequest,
  enqueueSyncRequest,
  removeApiQueueItem,
  removeSyncQueueItem,
  removeApiQueueItemsByKey,
  flushApiQueue,
  flushSyncQueue,
  getApiQueueSize,
  getSyncQueueSize,
} from './offlineQueue';

export { normalizeErrorResponseCore } from './responseNormalizer';

export { getCsrfToken, clearCsrfToken, httpFetch } from './csrf';

export { parseServiceRouteName } from './serviceRoute';

export {
  buildApiResponseEventName,
  buildApiStreamEventName,
  buildSyncProgressEventName,
  buildSyncResponseEventName,
  socketEventNames,
} from './socketEvents';

export type { statusContent, SOCKETSTATUS } from './socketStatusTypes';

export type { ApiTypeMap, SyncTypeMap, StreamPayload } from './apiTypeStubs';

export type { BaseSessionLayout, SessionLocation, AuthProps } from './sessionTypes';

export { getLogger, registerLogger } from './loggerRegistry';
export type { Logger, LoggerContext } from './loggerRegistry';

export {
  registerApiMethodMap,
  getRegisteredApiMethod,
  isApiMethodMapRegistered,
} from './apiMethodMapRegistry';
export type { HttpMethodLiteral, ApiMethodMap } from './apiMethodMapRegistry';

//? Locale registry — consumers register their translation JSON files via
//? `registerLocales(...)` from an overlay (e.g. `luckystack/i18n/locales.ts`).
//? `registerLanguageSource` wires up the framework's `TranslationProvider`
//? + `notify` to read the active language from the consumer's session
//? state (`() => session?.language ?? null`).
export {
  registerLocales,
  getRegisteredLocales,
  getDefaultLocale,
  registerLanguageSource,
  getActiveLanguage,
  getLocaleByCode,
} from './localesRegistry';
export type { LocalesMap, LanguageSource } from './localesRegistry';

//? Middleware handler registry — consumer ships the actual page-guard
//? logic (`src/_functions/middlewareHandler.ts`) and registers it from
//? their client bootstrap. Framework's `<Middleware>` and `useRouter`
//? consume it via `getMiddlewareHandler()`.
export {
  registerMiddlewareHandler,
  getMiddlewareHandler,
} from './middlewareRegistry';
export type {
  MiddlewareInput,
  MiddlewareResult,
  MiddlewareHandler,
} from './middlewareRegistry';

//? Framework-React surface. Provider + hooks consumers compose into
//? their app entry. Hooks (useSession, useTranslation, useTheme,
//? useRouter, useAvatarContext) work anywhere inside the matching
//? provider tree.
export {
  SessionContext,
  useSession,
  setLatestSession,
  getCurrentSession,
} from './react/sessionContext';
export type { SessionContextValue } from './react/sessionContext';

export { AvatarProvider, useAvatarContext } from './react/AvatarProvider';
export type { AvatarStatus } from './react/AvatarProvider';

export { useTheme } from './react/useTheme';
export type { Theme } from './react/useTheme';

export {
  TranslationProvider,
  useTranslation,
  useUpdateLanguage,
  translate,
  useTranslator,
} from './react/TranslationProvider';
export type { TranslationRecord, TranslateParam } from './react/TranslationProvider';

//? Re-export the i18n-backed notify from /react. Note: this is the
//? *implementation* — importing it is a side-effect that calls
//? `registerNotifier(...)` so framework packages emit through it.
//? Re-exported separately from the no-op `notify` higher in this file
//? so consumers can opt into the i18n implementation explicitly:
//?   `import '@luckystack/core/client/notify';`
//? (Actually re-exported here as well for convenience; importing this
//? barrel triggers the registration.)
export { default as i18nNotify } from './react/notify';

export { default as Middleware } from './react/Middleware';
export { default as useRouter } from './react/Router';
