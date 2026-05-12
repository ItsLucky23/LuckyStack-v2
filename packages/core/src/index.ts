export { default as sleep } from './sleep';
export { default as tryCatch } from './tryCatch';
export * from './serviceRoute';
export * from './socketEvents';
export * from './responseNormalizer';
export * from './localizedNormalizer';
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
  SecurityHeadersConfig,
  CorsConfig,
  AuthConfig,
  SocketConfig,
  SyncConfig,
  SyncStreamThrottleConfig,
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
  getEmailSender,
  isEmailSenderRegistered,
} from './emailRegistry';
export type { EmailSender, EmailMessage, EmailResult } from './emailRegistry';
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
export type { BaseSessionLayout, SessionLocation, AuthProps } from './sessionTypes';
export * from './sentrySetup';
export * from './env';
export * from './db';
export { redis, getRedisConnectionOptions } from './redis';
export type { RedisConnectionOptions } from './redis';
export {
  registerPrismaClient,
  registerRedisClient,
  getPrismaClient,
  getRedisClient,
  isPrismaClientRegistered,
  isRedisClientRegistered,
} from './clients';
export { attachSocketRedisAdapter } from './socketRedisAdapter';
export { writeBootUuid, readBootUuid, resolveEnvKey, BOOT_KEY_PREFIX } from './bootUuid';
export {
  collectSynchronizedEnvKeys,
  computeSynchronizedEnvHashes,
  hashSynchronizedValue,
} from './synchronizedEnvHashes';
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
} from './redactedLogKeys';
export * from './cookies';
export * from './httpApiUtils';
export * from './paths';
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
export { validateRequest, isFalsy } from './validateRequest';
export type { ValidationResult } from './validateRequest';
export { checkRateLimit, getRateLimitStatus, clearRateLimit, clearAllRateLimits } from './rateLimiter';
export { validateInputByType } from './runtimeTypeValidation';
export { default as allowedOrigin } from './checkOrigin';
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
export { socket, setSocket, incrementResponseIndex, waitForSocket } from './socketState';
export { getCsrfToken, clearCsrfToken, httpFetch } from './csrf';
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
  PreSyncFanoutPayload,
  PostSyncFanoutPayload,
  ApiErrorPayload,
  SyncErrorPayload,
  RateLimitExceededPayload,
  CorsRejectedPayload,
  CsrfMismatchPayload,
  PreSessionRefreshPayload,
  PostSessionRefreshPayload,
  OnUploadStartPayload,
  OnUploadCompletePayload,
  SyncHookName,
  SyncHookHandler,
  SyncHookPayloads,
  PreErrorNormalizePayload,
  PostErrorNormalizePayload,
} from './hooks/types';
