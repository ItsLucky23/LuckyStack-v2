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
