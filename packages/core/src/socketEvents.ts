const withIndex = (prefix: string, responseIndex: number | string): string => {
  return `${prefix}${String(responseIndex)}`;
};

export const socketEventNames = {
  apiRequest: 'apiRequest',
  apiCancel: 'apiCancel',
  sync: 'sync',
  syncCancel: 'syncCancel',
  joinRoom: 'joinRoom',
  leaveRoom: 'leaveRoom',
  getJoinedRooms: 'getJoinedRooms',
  updateLocation: 'updateLocation',
  updateSession: 'updateSession',
  sessionReplaced: 'sessionReplaced',
  logout: 'logout',

  intentionalDisconnect: 'intentionalDisconnect',
  intentionalReconnect: 'intentionalReconnect',
  //? Client -> server activity heartbeat (mouse/keyboard/touch), throttled.
  //? Drives the server-side activity sampler that fires registered activity
  //? events (e.g. the built-in AFK detector).
  activity: 'activity',
  userAfk: 'userAfk',
  userBack: 'userBack',
  //? Emitted to a room's remaining members when a peer leaves — hard disconnect
  //? (socket close) or grace-expiry (presence MIS-003). Lets clients prune a
  //? departed peer from their roster without polling. The presence package owns
  //? the dispatch; core owns the wire-event name so client + server can't drift.
  userLeft: 'userLeft',

  connect: 'connect',
  disconnect: 'disconnect',
  reconnectAttempt: 'reconnect_attempt',
  connectError: 'connect_error',

  apiResponsePrefix: 'apiResponse-',
  apiStreamPrefix: 'apiStream-',
  syncResponsePrefix: 'sync-',
  syncProgressPrefix: 'sync-progress-',
  joinRoomResponsePrefix: 'joinRoom-',
  leaveRoomResponsePrefix: 'leaveRoom-',
  getJoinedRoomsResponsePrefix: 'getJoinedRooms-',
} as const;

export const buildApiResponseEventName = (responseIndex: number | string): string => {
  return withIndex(socketEventNames.apiResponsePrefix, responseIndex);
};

export const buildApiStreamEventName = (responseIndex: number | string): string => {
  return withIndex(socketEventNames.apiStreamPrefix, responseIndex);
};

export const buildSyncResponseEventName = (responseIndex: number | string): string => {
  return withIndex(socketEventNames.syncResponsePrefix, responseIndex);
};

export const buildSyncProgressEventName = (responseIndex: number | string): string => {
  return withIndex(socketEventNames.syncProgressPrefix, responseIndex);
};

export const buildJoinRoomResponseEventName = (responseIndex: number | string): string => {
  return withIndex(socketEventNames.joinRoomResponsePrefix, responseIndex);
};

export const buildLeaveRoomResponseEventName = (responseIndex: number | string): string => {
  return withIndex(socketEventNames.leaveRoomResponsePrefix, responseIndex);
};

export const buildGetJoinedRoomsResponseEventName = (responseIndex: number | string): string => {
  return withIndex(socketEventNames.getJoinedRoomsResponsePrefix, responseIndex);
};
