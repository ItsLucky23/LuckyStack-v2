//? Client-side (browser-safe) surface of @luckystack/core.
//? Kept separate from `./index.ts` because the server barrel re-exports
//? Node-API modules (paths.ts, db.ts, redis.ts) that must never enter a
//? Vite client bundle.
//?
//? This file aggregates everything `@luckystack/sync/client` and project
//? client code may need so consumers can `import ... from '@luckystack/core/client'`
//? instead of reaching into specific source files via relative paths.

export { apiRequest } from './apiRequest';
export type { ApiStreamEvent, ApiErrorResponse } from './apiRequest';

//? Browser-safe helpers also re-used by server handlers via the
//? function-injection system. Exposed on `/client` so `shared/sleep.ts`
//? and `shared/tryCatch.ts` can resolve them without dragging the
//? server-only `bootUuid` / `redis` modules into a Vite client bundle.
export { default as sleep } from './sleep';
//? Browser-safe `tryCatch` (NOT the server `./tryCatch`): the server variant
//? statically imports `./sentrySetup` → `errorTrackerRegistry` → `node:async_hooks`,
//? which Vite externalizes for the client. Re-exporting it here would drag that
//? `node:`-bearing module into the static graph of every client barrel importer.
//? `tryCatchClient` is behaviourally identical but lazy-imports the capture seam.
export { default as tryCatch } from './tryCatchClient';
//? `tryCatchSync` needs NO client-specific variant: unlike the async `tryCatch`
//? it deliberately does not auto-capture to the error tracker, so the module has
//? ZERO imports — nothing `node:`-bearing can ride along. It was already being
//? shipped to the browser (the offline-queue drop handler calls it) and was
//? simply missing from this barrel. See `barrelParity.test.ts`, which now fails
//? if another zero-import util is exported server-side but not here.
export { default as tryCatchSync } from './tryCatchSync';

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
  buildJoinRoomResponseEventName,
  buildLeaveRoomResponseEventName,
  buildGetJoinedRoomsResponseEventName,
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

//? Middleware handler registry — per-page `export const middleware` is the
//? canonical guard path; a consumer wanting a cross-cutting GLOBAL guard
//? registers it from their client bootstrap via `registerMiddlewareHandler`
//? (no separate `middlewareHandler.ts` file required). Framework's
//? `<Middleware>` and `useRouter` consume it via `getMiddlewareHandler()`.
export {
  registerMiddlewareHandler,
  getMiddlewareHandler,
  registerPageMiddleware,
  getPageMiddleware,
  hasPageMiddleware,
} from './middlewareRegistry';
export type {
  MiddlewareInput,
  MiddlewareResult,
  MiddlewareHandler,
  PageMiddleware,
} from './middlewareRegistry';

//? Client-side hook bus. Subscribe to login / logout transitions detected
//? by the framework's session context. Counterpart to the server-side
//? `registerHook` system. See `clientHookBus.ts` for the full payload map.
//? `dispatchVetoableClientHook` + `proposeLogin` (re-exported from
//? `react/sessionContext`) give consumers stop-signal semantics matching
//? the server-side hook bus.
export {
  registerClientHook,
  dispatchClientHook,
  dispatchVetoableClientHook,
} from './clientHookBus';
export type {
  ClientHookName,
  ClientHookHandler,
  ClientHookPayloadMap,
  ClientHookStopSignal,
  ClientHookResult,
  ClientDispatchResult,
} from './clientHookBus';

//? EXT-03 — client request/response interceptor registry for `apiRequest`.
//? The sanctioned alternative to wrapping `apiRequest` (which Rule 21 / the
//? `no-unsafe-api-wrappers` lint forbid): register an interceptor to inject a
//? correlation id / feature-flag context onto outgoing calls, or to observe
//? responses, without erasing the typed call site's route/version inference.
export {
  registerApiRequestInterceptor,
  registerApiResponseInterceptor,
} from './apiInterceptors';
export type {
  ApiRequestInterceptor,
  ApiResponseInterceptor,
  ApiRequestInterceptorContext,
  ApiResponseInterceptorContext,
} from './apiInterceptors';

//? Pure page-route validator. Consumers' main.tsx auto-discovery uses this
//? to decide whether a discovered page.tsx becomes a route (and what URL),
//? and the same helper is used by the devkit scaffold CLI + hot-reload
//? warning. See `pageRouteValidation.ts` for the full convention.
export {
  validatePagePath,
  DEFAULT_PAGE_ROUTE_RULES,
} from './pageRouteValidation';
export type {
  PageRouteRules,
  PagePathValidationResult,
} from './pageRouteValidation';

//? Framework-React surface. Provider + hooks consumers compose into
//? their app entry. Hooks (useSession, useTranslation, useTheme,
//? useRouter, useAvatarContext) work anywhere inside the matching
//? provider tree.
export {
  SessionContext,
  useSession,
  setLatestSession,
  getCurrentSession,
  proposeLogin,
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
//?   `import { i18nNotify } from '@luckystack/core/client';`
//? Importing this barrel triggers the registration as a side effect.
export { default as i18nNotify } from './react/notify';

export { default as Middleware } from './react/Middleware';
export { default as useRouter } from './react/Router';
