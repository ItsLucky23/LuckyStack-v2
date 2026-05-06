//? Static convention defaults. These remain exported for backwards
//? compatibility with code that accesses them as RegExp/string literals
//? (e.g. `name.replace(API_VERSION_TOKEN_REGEX, '')`). Call sites that
//? must honor consumer-overridden conventions read from
//? `getRoutingRules()` (in `./routingRules.ts`) instead.

import {
  isApiFileName as isApi,
  isSyncFileName as isSync,
  isSyncServerFileName as isSyncServer,
  isSyncClientFileName as isSyncClient,
} from './routingRules';

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

//? These checks honor `registerRoutingRules({...})` overrides because they
//? delegate to the registry-aware functions in `./routingRules`.
export const isVersionedApiFileName = (fileName: string): boolean => isApi(fileName);
export const isVersionedSyncFileName = (fileName: string): boolean => isSync(fileName);
export const isVersionedSyncServerFileName = (fileName: string): boolean => isSyncServer(fileName);
export const isVersionedSyncClientFileName = (fileName: string): boolean => isSyncClient(fileName);
