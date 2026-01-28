/**
 * Auto-generated type map for all API and Sync endpoints.
 * Enables type-safe apiRequest and syncRequest calls.
 */

import { PrismaClient } from "@prisma/client";
import { SessionLayout } from "config";

export interface Functions {
  prisma: PrismaClient;

  saveSession: (sessionId: string, data: SessionLayout) => Promise<boolean>;
  getSession: (sessionId: string) => Promise<SessionLayout | null>;
  deleteSession: (sessionId: string) => Promise<boolean>;

  tryCatch: <T, P>(func: (values: P) => Promise<T> | T, params?: P) => Promise<[any, T | null]>;

  [key: string]: any; // allows for other functions that are not defined as a type but do exist in the functions folder
};

// ═══════════════════════════════════════════════════════════════════════════════
// API Type Definitions
// ═══════════════════════════════════════════════════════════════════════════════

export type ApiResponse<T = any> =
  | { status: 'success'; result: T }
  | { status: 'error'; message?: string; errors?: any };

// ═══════════════════════════════════════════════════════════════════════════════
// API Type Map
// ═══════════════════════════════════════════════════════════════════════════════

export interface ApiTypeMap {
  'examples': {
    'adminOnly': {
      input: { };
      output: { status: 'success'; result: { message: string; adminInfo: { userId: any; email: any; isAdmin: boolean; accessedAt: Date } } };
    };
    'publicApi': {
      input: { message: string; };
      output: { status: 'success'; result: { message: string; serverTime: Date } };
    };
    'toggleAdmin': {
      input: { };
      output: { status: 'success'; result: { message: string; admin: any; previousStatus: any } };
    };
  };
  'settings': {
    'updateUser': {
      input: Record<string, any>;
      output: { status: 'error' } | { status: 'success' };
    };
  };
}

// API Type helpers - fall back to permissive types when map is empty
type _PagePath = keyof ApiTypeMap;
export type PagePath = _PagePath extends never ? string : _PagePath;
export type ApiName<P extends PagePath> = P extends _PagePath ? keyof ApiTypeMap[P] : string;
export type ApiInput<P extends PagePath, N extends ApiName<P>> = P extends _PagePath ? (ApiTypeMap[P][N & keyof ApiTypeMap[P]] extends { input: infer I } ? I : any) : any;
export type ApiOutput<P extends PagePath, N extends ApiName<P>> = P extends _PagePath ? (ApiTypeMap[P][N & keyof ApiTypeMap[P]] extends { output: infer O } ? O : any) : any;

// Full API path helper (can be used for debugging)
export type FullApiPath<P extends PagePath, N extends ApiName<P>> = `api/${P}/${N & string}`;

// ═══════════════════════════════════════════════════════════════════════════════
// Sync Type Definitions
// ═══════════════════════════════════════════════════════════════════════════════

export type SyncServerResponse<T = any> =
  | { status: 'success' } & T
  | { status: 'error'; message?: string };

export type SyncClientResponse<T = any> =
  | { status: 'success' } & T
  | { status: 'error'; message?: string };

// ═══════════════════════════════════════════════════════════════════════════════
// Sync Type Map
// ═══════════════════════════════════════════════════════════════════════════════

export interface SyncTypeMap {
  'examples': {
    'updateCounter': {
      clientInput: { };
      serverData: { status: 'success'; increase: any };
      clientOutput: { status: 'success'; randomKey: boolean };
    };
  };
}

// Sync Type helpers - fall back to permissive types when map is empty
type _SyncPagePath = keyof SyncTypeMap;
export type SyncPagePath = _SyncPagePath extends never ? string : _SyncPagePath;
export type SyncName<P extends SyncPagePath> = P extends _SyncPagePath ? keyof SyncTypeMap[P] : string;
export type SyncClientInput<P extends SyncPagePath, N extends SyncName<P>> = P extends _SyncPagePath ? (SyncTypeMap[P][N & keyof SyncTypeMap[P]] extends { clientInput: infer C } ? C : any) : any;
export type SyncServerData<P extends SyncPagePath, N extends SyncName<P>> = P extends _SyncPagePath ? (SyncTypeMap[P][N & keyof SyncTypeMap[P]] extends { serverData: infer S } ? S : any) : any;
export type SyncClientOutput<P extends SyncPagePath, N extends SyncName<P>> = P extends _SyncPagePath ? (SyncTypeMap[P][N & keyof SyncTypeMap[P]] extends { clientOutput: infer O } ? O : any) : any;

// Full Sync path helper (can be used for debugging)
export type FullSyncPath<P extends SyncPagePath, N extends SyncName<P>> = `sync/${P}/${N & string}`;
