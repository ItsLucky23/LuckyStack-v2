/**
 * Auto-generated type map for all API endpoints.
 * Enables type-safe apiRequest calls.
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

export interface ApiTypeMap {
  'examples': {
    'adminOnly': {
      input: Record<string, any>;
      output: { status: string; result: { message: string; adminInfo: { userId: string; email: string; isAdmin: boolean; accessedAt: string } } };
    };
    'jow': {
      input: { email: string; };
      output: { status: string; result: { age: any } };
    };
    'maintest': {
      input: { name: string; email: string; test: number; };
      output: { status: string; result: { data: { name: string; email: string; test: number; }; data2: { name: string; email: string; test: number; }; name: string; name123: number } };
    };
    'publicApi': {
      input: Record<string, any>;
      output: { status: string; result: { message: string; timestamp: string; serverTime: string } };
    };
    'toggleAdmin': {
      input: Record<string, any>;
      output: { status: string; result: { message: string; admin: any; previousStatus: boolean } };
    };
  };
  'examples/examples2': {
    'jow': {
      input: { name: string; };
      output: { status: string; result: { name: string } };
    };
    'skibidi': {
      input: { name: string; };
      output: { status: string; result: { name: any } };
    };
  };
  'settings': {
    'updateUser': {
      input: Record<string, any>;
      output: { status: string; result: any };
    };
  };
}

// Type helpers
export type PagePath = keyof ApiTypeMap;
export type ApiName<P extends PagePath> = keyof ApiTypeMap[P];
export type ApiInput<P extends PagePath, N extends ApiName<P>> = ApiTypeMap[P][N] extends { input: infer I } ? I : never;
export type ApiOutput<P extends PagePath, N extends ApiName<P>> = ApiTypeMap[P][N] extends { output: infer O } ? O : never;

// Full API path helper (can be used for debugging)
export type FullApiPath<P extends PagePath, N extends ApiName<P>> = `api/${P}/${N & string}`;
