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

// Consumer template override registry — `registerTemplate('page_plain', ...)`
// lets a project ship its own scaffold templates without forking devkit.
// See `docs/ARCHITECTURE_EXTENSION_POINTS.md` for the consumer usage pattern.
export {
  registerTemplate,
  getRegisteredTemplate,
  clearTemplateOverrides,
  listRegisteredTemplateKinds,
  registerTemplateRule,
  registerTemplateKind,
  clearTemplateRules,
  getTemplateRules,
  resolveTemplateKind,
  registerDefaultTemplateRules,
  BUILT_IN_TEMPLATE_KINDS,
  BUILT_IN_TEMPLATE_FILENAMES,
  DEFAULT_DASHBOARD_PATH_PATTERN,
} from './templateRegistry';
export type {
  TemplateKind,
  BuiltInTemplateKind,
  TemplateRule,
  TemplateMatchContext,
  RegisterTemplateKindOptions,
} from './templateRegistry';

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

// Pre-deploy validator (consumed by the `luckystack-validate-deploy` CLI; safe to call directly from build scripts).
export { validateDeploy } from './validateDeploy';
export type {
  ValidateDeployInput,
  ValidateDeployResult,
  ValidationFinding,
  ValidationSeverity,
} from './validateDeploy';
