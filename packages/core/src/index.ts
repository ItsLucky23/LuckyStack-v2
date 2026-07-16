export { default as sleep } from './sleep';
export { default as tryCatch } from './tryCatch';
export { default as tryCatchSync } from './tryCatchSync';
export { deepMerge, isPlainObject } from './configUtils';
export type { DeepPartial } from './configUtils';
export { createRegistry } from './createRegistry';
export type { Registry, RegistryOptions } from './createRegistry';
export { escapeHtml } from './escapeHtml';
export { ensurePeerDepInstalled, loadPeer } from './peerDeps';
export type { PeerRequire } from './peerDeps';
export * from './serviceRoute';
export * from './socketEvents';
export {
  registerRoomNameFormatter,
  getRoomNameFormatter,
  formatRoomName,
  defaultRoomNameFormatter,
} from './roomNameFormatterRegistry';
export type { RoomNameFormatter, RoomNameFormatterContext } from './roomNameFormatterRegistry';
export * from './responseNormalizer';
export * from './localizedNormalizer';
export {
  registerErrorFormatter,
  getErrorFormatter,
  applyErrorFormatter,
} from './errorFormatterRegistry';
export type { ErrorFormatter, ErrorFormatterContext, FormatterEnvelope } from './errorFormatterRegistry';
export {
  validatePagePath,
  DEFAULT_PAGE_ROUTE_RULES,
} from './pageRouteValidation';
export type {
  PageRouteRules,
  PagePathValidationResult,
} from './pageRouteValidation';
export type { ApiTypeMap, SyncTypeMap, StreamPayload } from './apiTypeStubs';
export type { apiMessage, syncMessage } from './socketTypes';
export { setIoInstance, getIoInstance } from './socketTypes';
export {
  registerProjectConfig,
  getProjectConfig,
  getProjectName,
  isProjectConfigRegistered,
  DEFAULT_PROJECT_CONFIG,
} from './projectConfig';
export type {
  ProjectConfig,
  ProjectConfigInput,
  AppConfig,
  LoggingConfig,
  RateLimitingConfig,
  SessionConfig,
  HttpConfig,
  HttpStreamConfig,
  HealthHashConfig,
  SecurityHeadersConfig,
  CorsConfig,
  AuthConfig,
  AuthRateLimitConfig,
  RateLimitIdentity,
  RateLimitIdentityParams,
  PasswordPolicyConfig,
  SocketConfig,
  ApiConfig,
  ValidationConfig,
  SyncConfig,
  SyncStreamThrottleConfig,
  SyncFlushPressureConfig,
  OfflineQueueConfig,
  DevConfig,
  PathsConfig,
} from './projectConfig';
export {
  registerRuntimeMapsProvider,
  getRuntimeApiMaps,
  getRuntimeSyncMaps,
  isRuntimeMapsProviderRegistered,
} from './runtimeMapsRegistry';
export {
  registerApiMethodMap,
  getRegisteredApiMethod,
  isApiMethodMapRegistered,
} from './apiMethodMapRegistry';
export type { HttpMethodLiteral, ApiMethodMap } from './apiMethodMapRegistry';
export type {
  RuntimeMapsProvider,
  RuntimeApiMapsResult,
  RuntimeSyncMapsResult,
} from './runtimeMapsRegistry';
export {
  registerNotifier,
  getNotifier,
  notify,
} from './notifier';
export type { Notifier, NotifyInput, NotifyParam } from './notifier';
export {
  registerEmailSender,
  registerEmailSenders,
  getEmailSender,
  getEmailSenderByName,
  listEmailSenderNames,
  isEmailSenderRegistered,
} from './emailRegistry';
export type { EmailSender, EmailMessage, EmailAttachment, EmailResult, EmailSenderRegistry } from './emailRegistry';
export {
  registerDeployConfig,
  getDeployConfig,
  isDeployConfigRegistered,
} from './deployConfigRegistry';
export type {
  DeployConfigShape,
  DeployResourceShape,
  DeployEnvironmentShape,
  DeployRoutingShape,
  DeployDevelopmentShape,
} from './deployConfigRegistry';
export {
  registerServicesConfig,
  getServicesConfig,
  isServicesConfigRegistered,
} from './servicesConfigRegistry';
export type {
  ServicesConfigShape,
  ServiceDefinition,
  PresetDefinition,
} from './servicesConfigRegistry';
export {
  registerLocaleReloader,
  getLocaleReloader,
} from './localeReloader';
export type { LocaleReloader } from './localeReloader';
export type { statusContent, SOCKETSTATUS } from './socketStatusTypes';
export type { BaseSessionLayout, SessionLocation, AuthProps, Jsonify } from './sessionTypes';
export * from './sentrySetup';
export {
  registerErrorTracker,
  registerErrorTrackers,
  appendErrorTracker,
  getActiveErrorTrackers,
  captureExceptionAcrossTrackers,
  captureMessageAcrossTrackers,
  setErrorTrackerUser,
  recordMetricAcrossTrackers,
  startSpanAcrossTrackers,
  startSpanHandle,
  registerPreCaptureFilter,
  flushErrorTrackers,
  sanitizeErrorString,
  sanitizeErrorStrings,
} from './errorTrackerRegistry';
export type {
  ErrorTracker,
  ErrorTrackerContext,
  ErrorTrackerUser,
  ErrorTrackerEvent,
  SpanResult,
  SpanHandle,
  PreCaptureFilter,
} from './errorTrackerRegistry';
export {
  runWithErrorTrackerIdentity,
  runWithErrorTrackerIdentityScope,
  setCurrentErrorTrackerIdentity,
  getCurrentErrorTrackerIdentity,
} from './errorTrackerIdentity';
export * from './env';
export * from './db';
export {
  registerDbHealthCheck,
  getDbHealthCheck,
  isDbHealthCheckRegistered,
  resetDbHealthCheckForTests,
} from './dbHealthCheck';
export type { DbHealthCheck, DbHealthResult } from './dbHealthCheck';
export { redis, getRedisConnectionOptions, registerStrayPrefixCommand, resetDefaultRedisClient, rebuildDefaultRedisClient } from './redis';
export type { RedisConnectionOptions } from './redis';
export { registerSecretsResolvedListener, notifySecretsResolved } from './secretsResolved';
export type { SecretsResolvedListener } from './secretsResolved';
export {
  registerRedisKeyFormatter,
  getRedisKeyFormatter,
  resetRedisKeyFormatterForTests,
  defaultRedisKeyFormatter,
  formatKey,
  applyStrayKeyPrefix,
} from './redisKeyFormatter';
export type { RedisKeyFormatter } from './redisKeyFormatter';
export { acquireLease, renewLease, releaseLease } from './lease';
export {
  DEFAULT_CLIENT_KEY,
  registerPrismaClient,
  registerRedisClient,
  getPrismaClient,
  getRedisClient,
  getPrismaClientFor,
  getRedisClientFor,
  getPrismaClientKeys,
  getRedisClientKeys,
  isPrismaClientRegistered,
  isRedisClientRegistered,
  resetClientsForTests,
} from './clients';
export { attachSocketRedisAdapter } from './socketRedisAdapter';
export { writeBootUuid, readBootUuid, resolveEnvKey, BOOT_KEY_PREFIX } from './bootUuid';
export {
  collectSynchronizedEnvKeys,
  computeSynchronizedEnvHashes,
  hashSynchronizedValue,
  hashSynchronizedValueWith,
  resolveHealthHashConfig,
  describeHealthHashConfig,
  resolveHealthHashConfigFromDescriptor,
} from './synchronizedEnvHashes';
export type { HealthHashDescriptor } from './synchronizedEnvHashes';
export { initConsolelog } from './consoleLog';
export {
  registerLogger,
  getLogger,
  isLoggerRegistered,
  resetLoggerForTests,
  createDevLogger,
} from './loggerRegistry';
export type { Logger, LoggerContext } from './loggerRegistry';
export {
  registerRedactedLogKeys,
  getRedactedLogKeys,
  isRedactedLogKey,
  resetRedactedLogKeysForTests,
  sanitizeForLog,
  DEFAULT_REDACTED_LOG_KEYS,
  REDACTED_PLACEHOLDER,
  DEPTH_TRUNCATED_PLACEHOLDER,
} from './redactedLogKeys';
export * from './cookies';
export * from './httpApiUtils';
export * from './paths';
export {
  registerSocketMiddleware,
  getSocketMiddlewares,
  clearSocketMiddlewares,
  applySocketMiddlewares,
} from './socketMiddlewareRegistry';
export type { SocketMiddleware } from './socketMiddlewareRegistry';
export {
  registerCsrfConfig,
  getCsrfConfig,
  resetCsrfConfigForTests,
  DEFAULT_CSRF_CONFIG,
} from './csrfConfig';
export type { CsrfConfig, CsrfCookieOptions } from './csrfConfig';
export { serveAvatar } from './serveAvatars';
export { processUpload } from './processUpload';
export type { ProcessUploadInput, ProcessUploadResult } from './processUpload';
export { registerBindAddress, getBindAddress } from './bindAddress';
export {
  registerAvatarConfig,
  getAvatarConfig,
  DEFAULT_AVATAR_CONFIG,
} from './avatarConfig';
export type { AvatarConfig, AvatarConfigInput } from './avatarConfig';
export { default as getParams } from './getParams';
export { extractTokenFromSocket } from './extractToken';
export { extractTokenFromRequest } from './extractTokenFromRequest';
export { resolveClientIp, isLoopbackIp, UNKNOWN_CLIENT_IP, deriveTokenBucketId } from './resolveClientIp';
export type { ResolveClientIpParams } from './resolveClientIp';
export {
  registerSessionProvider,
  getRegisteredSessionProvider,
  isSessionProviderRegistered,
  resetSessionProviderForTests,
  readSession,
  writeSession,
  removeSession,
  performLogout,
} from './sessionProviderRegistry';
export type { SessionProvider, SessionSaveResult, SessionLogoutInput } from './sessionProviderRegistry';
export { validateRequest, isFalsy } from './validateRequest';
export type { ValidationResult } from './validateRequest';
export {
  checkRateLimit,
  getRateLimitStatus,
  clearRateLimit,
  clearAllRateLimits,
  registerRateLimitStrategy,
  getRateLimitStrategy,
  defaultRateLimitStrategy,
} from './rateLimiter';
export type { RateLimitStrategy, CheckRateLimitParams, RateLimitResult } from './rateLimiter';
export { validateInputByType } from './runtimeTypeValidation';
export { default as allowedOrigin, normalizeOrigin } from './checkOrigin';
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
export type { QueueDropReason } from './offlineQueue';
export { socket, setSocket, incrementResponseIndex, waitForSocket } from './socketState';
export {
  registerSyncAbortController,
  unregisterSyncAbortController,
  abortSyncByCb,
  registerApiAbortController,
  unregisterApiAbortController,
  abortApiByResponseIndex,
  abortAllForSocket,
} from './cancelRegistry';
export { getCsrfToken, clearCsrfToken, httpFetch } from './csrf';
export {
  issueOneTimeToken,
  consumeOneTimeToken,
  consumeOneTimeTokenJson,
  oneTimeTokenKey,
} from './oneTimeToken';
export type { OneTimeTokenHandle } from './oneTimeToken';
// `apiRequest` is exported from `./client.ts` — it imports React-coupled
// project code (notify → TranslationProvider.tsx) that must not be pulled
// into server compilation via this server-safe barrel.
export { registerHook, dispatchHook, clearAllHooks, registerSyncHook, dispatchSyncHook } from './hooks/registry';
export type { DispatchResult } from './hooks/registry';
export type {
  HookSessionShape,
  HookStopSignal,
  HookResult,
  HookHandler,
  HookName,
  HookPayloads,
  PreApiValidatePayload,
  PostApiValidatePayload,
  PreApiExecutePayload,
  PostApiExecutePayload,
  PreApiRespondPayload,
  PostApiRespondPayload,
  ApiResponseEnvelope,
  PreHttpRequestPayload,
  PostHttpRequestPayload,
  PreSocketMessagePayload,
  PreSyncAuthorizePayload,
  PostSyncAuthorizePayload,
  PreSyncValidatePayload,
  PostSyncValidatePayload,
  PreSyncExecutePayload,
  PostSyncExecutePayload,
  PreSyncFanoutPayload,
  PostSyncFanoutPayload,
  PreSyncRecipientPayload,
  ApiErrorPayload,
  SyncErrorPayload,
  ApiAuthRejectedPayload,
  RateLimitExceededPayload,
  CorsRejectedPayload,
  CsrfMismatchPayload,
  PreSessionRefreshPayload,
  PostSessionRefreshPayload,
  SessionCreatedPayload,
  SessionRevokedPayload,
  OnUploadStartPayload,
  OnUploadCompletePayload,
  PreAvatarServePayload,
  PostAvatarServePayload,
  PreServerStopPayload,
  SyncHookName,
  SyncHookHandler,
  SyncHookPayloads,
  PreErrorNormalizePayload,
  PostErrorNormalizePayload,
} from './hooks/types';
