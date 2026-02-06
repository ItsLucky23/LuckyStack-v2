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
      method: 'POST';
    };
    'publicApi': {
      input: { message: string; };
      output: { status: 'success'; result: { message: string; serverTime: Date } };
      method: 'POST';
    };
    'toggleAdmin': {
      input: { };
      output: { status: 'success'; result: { message: string; admin: any; previousStatus: any } };
      method: 'POST';
    };
  };
  'settings': {
    'updateUser': {
      input: { name?: string; theme?: 'light' | 'dark'; language?: string; avatar?: string; };
      output: { status: 'error' } | { status: 'success'; result: { } };
      method: 'POST';
    };
  };
}

// HTTP Method type
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

// API Type helpers
export type PagePath = keyof ApiTypeMap;
export type ApiName<P extends PagePath> = keyof ApiTypeMap[P];
export type ApiInput<P extends PagePath, N extends ApiName<P>> = ApiTypeMap[P][N] extends { input: infer I } ? I : never;
export type ApiOutput<P extends PagePath, N extends ApiName<P>> = ApiTypeMap[P][N] extends { output: infer O } ? O : never;
export type ApiMethod<P extends PagePath, N extends ApiName<P>> = ApiTypeMap[P][N] extends { method: infer M } ? M : never;

// Full API path helper (can be used for debugging)
export type FullApiPath<P extends PagePath, N extends ApiName<P>> = `api/${P}/${N & string}`;

// ═══════════════════════════════════════════════════════════════════════════════
// Runtime API Method Map (for abort controller logic)
// ═══════════════════════════════════════════════════════════════════════════════

export const apiMethodMap: Record<string, Record<string, HttpMethod>> = {
  'examples': {
    'adminOnly': 'POST',
    'publicApi': 'POST',
    'toggleAdmin': 'POST',
  },
  'settings': {
    'updateUser': 'POST',
  },
};

/**
 * Get the HTTP method for an API. Used by apiRequest for abort controller logic.
 */
export const getApiMethod = (pagePath: string, apiName: string): HttpMethod | undefined => {
  return apiMethodMap[pagePath]?.[apiName];
};


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
      clientInput: { increase: boolean; };
      serverOutput: { status: 'success'; increase: any };
      clientOutput: { status: 'success'; randomKey: boolean };
    };
  };
}

// Sync Type helpers
export type SyncPagePath = keyof SyncTypeMap;
export type SyncName<P extends SyncPagePath> = keyof SyncTypeMap[P];
export type SyncClientInput<P extends SyncPagePath, N extends SyncName<P>> = SyncTypeMap[P][N] extends { clientInput: infer C } ? C : never;
export type SyncServerOutput<P extends SyncPagePath, N extends SyncName<P>> = SyncTypeMap[P][N] extends { serverOutput: infer S } ? S : never;
export type SyncClientOutput<P extends SyncPagePath, N extends SyncName<P>> = SyncTypeMap[P][N] extends { clientOutput: infer O } ? O : never;

// Full Sync path helper (can be used for debugging)
export type FullSyncPath<P extends SyncPagePath, N extends SyncName<P>> = `sync/${P}/${N & string}`;
