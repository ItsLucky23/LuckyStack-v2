export const API_VERSION_TOKEN_REGEX = /_v(\d+)$/;
export const SYNC_VERSION_TOKEN_REGEX = /_(server|client)_v(\d+)$/;

export const API_VERSIONED_FILE_REGEX = /_v\d+\.ts$/;
export const SYNC_SERVER_VERSIONED_FILE_REGEX = /_server_v\d+\.ts$/;
export const SYNC_CLIENT_VERSIONED_FILE_REGEX = /_client_v\d+\.ts$/;
export const SYNC_VERSIONED_FILE_REGEX = /_(?:server|client)_v\d+\.ts$/;

export const ROUTE_NAMING_RULES = {
  api: '<name>_v<number>.ts',
  syncServer: '<name>_server_v<number>.ts',
  syncClient: '<name>_client_v<number>.ts',
} as const;

export const ROUTE_NAMING_EXAMPLES = {
  api: 'updateUser_v1.ts',
  syncServer: 'updateCounter_server_v1.ts',
  syncClient: 'updateCounter_client_v1.ts',
} as const;

export const isVersionedApiFileName = (fileName: string): boolean => {
  return API_VERSIONED_FILE_REGEX.test(fileName);
};

export const isVersionedSyncFileName = (fileName: string): boolean => {
  return SYNC_VERSIONED_FILE_REGEX.test(fileName);
};

export const isVersionedSyncServerFileName = (fileName: string): boolean => {
  return SYNC_SERVER_VERSIONED_FILE_REGEX.test(fileName);
};

export const isVersionedSyncClientFileName = (fileName: string): boolean => {
  return SYNC_CLIENT_VERSIONED_FILE_REGEX.test(fileName);
};
