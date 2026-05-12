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
export { bootstrapLuckyStack } from './bootstrap';
export type { BootstrapLuckyStackOptions } from './bootstrap';
export { verifyBootstrap } from './verifyBootstrap';
export type { BootstrapRequirements } from './verifyBootstrap';
export {
  createProdRuntimeMapsProvider,
  registerProdRuntimeMapsProvider,
} from './runtimeMapsLoader';
export type { ProdRuntimeMapsLoaderOptions } from './runtimeMapsLoader';
export {
  registerCustomRoute,
  getCustomRoutes,
  clearCustomRoutes,
} from './customRoutesRegistry';
export type {
  CreateLuckyStackServerOptions,
  RunningLuckyStackServer,
  RouteContext,
  StaticFileHandler,
  FaviconHandler,
  CustomRouteHandler,
} from './types';
