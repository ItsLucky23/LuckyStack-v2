const withIndex = (prefix: string, responseIndex: number | string): string => {
  return `${prefix}${String(responseIndex)}`;
};

export const socketEventNames = {
  apiRequest: 'apiRequest',
  sync: 'sync',
  joinRoom: 'joinRoom',
  leaveRoom: 'leaveRoom',
  getJoinedRooms: 'getJoinedRooms',
  updateLocation: 'updateLocation',
  updateSession: 'updateSession',
  logout: 'logout',

  intentionalDisconnect: 'intentionalDisconnect',
  intentionalReconnect: 'intentionalReconnect',
  userAfk: 'userAfk',
  userBack: 'userBack',

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
