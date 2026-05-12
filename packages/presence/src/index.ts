import './hookPayloads';
export type { PrePresenceUpdatePayload, PostPresenceUpdatePayload } from './hookPayloads';

export { socketLeaveRoom } from './activity/leaveRoom';
export { initActivityBroadcaster, socketConnected, socketDisconnecting } from './activity/lifecycle';
export {
  disconnectTimers,
  tempDisconnectedSockets,
  clientSwitchedTab,
} from './activity/state';
export { registerPresenceHooks } from './hooks';
export {
  registerPresenceConfig,
  getPresenceConfig,
  DEFAULT_PRESENCE_CONFIG,
} from './presenceConfig';
export type {
  PresenceConfig,
  PresenceConfigInput,
  DisconnectTimers,
} from './presenceConfig';
