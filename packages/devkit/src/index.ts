// Type generation + route validation (consumed by scripts/generate*.ts)
export { generateTypeMapFile } from './typeMapGenerator';
export {
  getInputTypeFromFile,
  getSyncClientDataType,
} from './typeMap/extractors';
export {
  API_VERSION_TOKEN_REGEX,
  SYNC_VERSION_TOKEN_REGEX,
} from './routeConventions';
export {
  assertNoDuplicateNormalizedRouteKeys,
  assertValidRouteNaming,
} from './routeNamingValidation';

// Routing rules registry (Phase 1.5).
export {
  registerRoutingRules,
  getRoutingRules,
  apiMarkerSegment,
  syncMarkerSegment,
  isApiFileName,
  isSyncFileName,
  isSyncServerFileName,
  isSyncClientFileName,
} from './routingRules';
export type { RoutingRules } from './routingRules';

// Runtime dev loaders (consumed by server/prod/runtimeMaps.ts when NODE_ENV !== 'production')
export {
  devApis,
  devSyncs,
  devFunctions,
  initializeAll,
  initializeApis,
  initializeSyncs,
  initializeFunctions,
  upsertApiFromFile,
  removeApiFromFile,
  upsertSyncFromFile,
  removeSyncFromFile,
} from './loader';

// Hot reload wiring (consumed at dev server startup)
export { setupWatchers } from './hotReload';

// Deep type resolver (consumed lazily by @luckystack/core's runtimeTypeValidation.ts, dev-only)
export { resolveRuntimeTypeText, clearRuntimeTypeResolverCache } from './runtimeTypeResolver';
