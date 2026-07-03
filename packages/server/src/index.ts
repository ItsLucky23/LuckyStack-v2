// Registers module augmentations on @luckystack/core for socket lifecycle hooks.
import './hookPayloads';

export { createLuckyStackServer } from './createServer';
export type {
  OnSocketConnectPayload,
  OnSocketDisconnectPayload,
  PreRoomJoinPayload,
  PostRoomJoinPayload,
  PreRoomLeavePayload,
  PostRoomLeavePayload,
  OnLocationUpdatePayload,
} from './hookPayloads';
export { bootstrapLuckyStack, registerOverlayLoader } from './bootstrap';
export type { BootstrapLuckyStackOptions } from './bootstrap';
export { verifyBootstrap } from './verifyBootstrap';
export type { BootstrapRequirements } from './verifyBootstrap';
export {
  createProdRuntimeMapsProvider,
  registerProdRuntimeMapsProvider,
} from './runtimeMapsLoader';
export type { ProdRuntimeMapsLoaderOptions, GeneratedRuntimeMapsModule } from './runtimeMapsLoader';
export {
  applyServerArgv,
  parseServerArgv,
  getParsedBundles,
  getParsedPort,
} from './argv';
export type { ParsedServerArgv } from './argv';
export {
  registerCustomRoute,
  getCustomRoutes,
  getPreParamsCustomRoutes,
  clearCustomRoutes,
} from './customRoutesRegistry';
export type { RegisterCustomRouteOptions } from './customRoutesRegistry';
export {
  registerOriginExemptPath,
  getOriginExemptPaths,
  clearOriginExemptPaths,
  isOriginExemptPath,
} from './originExemptRegistry';
export type { OriginExemptMatcher } from './originExemptRegistry';
export {
  registerSecurityHeaders,
  getSecurityHeadersBuilder,
} from './securityHeadersRegistry';
export type { SecurityHeadersBuilder } from './securityHeadersRegistry';
export {
  registerErrorFormatter,
  getErrorFormatter,
} from './errorFormatterRegistry';
export type { ErrorFormatter, ErrorFormatterContext } from './errorFormatterRegistry';
export type {
  CreateLuckyStackServerOptions,
  RunningLuckyStackServer,
  StopLuckyStackServerOptions,
  RouteContext,
  StaticFileHandler,
  FaviconHandler,
  CustomRouteHandler,
  CustomRoutePhase,
} from './types';
