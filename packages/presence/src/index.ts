import './hookPayloads';
import { registerDefaultAfkEvent } from './activity/afkEvent';
export type {
  PrePresenceUpdatePayload,
  PostPresenceUpdatePayload,
  PostSocketReconnectPayload,
  PostDisconnectGraceExpiredPayload,
} from './hookPayloads';

export { socketLeaveRoom } from './activity/leaveRoom';
export { initActivityBroadcaster, socketConnected, socketDisconnecting } from './activity/lifecycle';
export {
  registerActivityEvent,
  unregisterActivityEvent,
  listActivityEvents,
  dispatchActivitySample,
  clearActivityThrottle,
} from './activityEvents';
export type { ActivityEvent, ActivitySample } from './activityEvents';
export {
  recordActivity,
  clearActivity,
  startActivitySampler,
  stopActivitySampler,
  getLastActivity,
  getRoomPresence,
} from './activity/activitySampler';
export type { RoomPresenceEntry } from './activity/activitySampler';

//? Auto-register the default AFK event at module load so a fresh install
//? gets AFK detection without an explicit registration step. Consumers
//? wanting alternative semantics can call `unregisterActivityEvent('afk')`
//? then register their own.
registerDefaultAfkEvent();
export {
  disconnectTimers,
  tempDisconnectedSockets,
  clientSwitchedTab,
  lastAfkFireByToken,
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
