/* eslint-disable */
//? Auto-generated Zod schemas for every API input. Driven by the same walk
//? as apiTypes.generated.ts; see @luckystack/devkit/src/typeMap/zodEmitter.ts
//? for the TS-AST → Zod converter. Types that fall outside the converter's
//? scope emit `z.any()` with a TODO comment.

import { z } from 'zod';

export const apiInputSchemas: Record<string, Record<string, Record<string, z.ZodTypeAny>>> = {
  'playground': {
    'echo': {
      'v1': z.object({ "message": z.string() }),
    },
    'spam': {
      'v1': z.object({}).strict(),
    },
    'streamCounter': {
      'v1': z.object({ "ticks": z.number().optional(), "intervalMs": z.number().optional() }),
    },
    'throwError': {
      'v1': z.object({ "mode": z.union([z.literal("throw"), z.literal("returnError")]).optional(), "errorCode": z.string().optional() }),
    },
  },
  'reset-password': {
    'confirmReset': {
      'v1': z.object({ "token": z.string(), "password": z.string(), "confirmPassword": z.string() }),
    },
    'sendReset': {
      'v1': z.object({ "email": z.string() }),
    },
  },
  'settings': {
    'changePassword': {
      'v1': z.object({ "currentPassword": z.string(), "newPassword": z.string(), "confirmPassword": z.string() }),
    },
    'deleteAccount': {
      'v1': z.object({ "confirmation": z.string(), "password": z.string().optional() }),
    },
    'listSessions': {
      'v1': z.object({}).strict(),
    },
    'revokeSession': {
      'v1': z.object({ "token": z.string() }),
    },
    'signOutEverywhere': {
      'v1': z.object({}).strict(),
    },
    'updatePreferences': {
      'v1': z.object({ "preferences": z.object({ "notifyOnNewSignIn": z.union([z.literal(false), z.literal(true)]).optional(), "notifyOnPasswordChange": z.union([z.literal(false), z.literal(true)]).optional() }) }),
    },
    'updateUser': {
      'v1': z.object({ "name": z.string().optional(), "theme": z.union([z.literal("dark"), z.literal("light")]).optional(), "language": z.union([z.literal("nl"), z.literal("en"), z.literal("de"), z.literal("fr")]).optional(), "avatar": z.string().optional() }),
    },
  },
  'system': {
    'logout': {
      'v1': z.object({}).strict(),
    },
    'session': {
      'v1': z.object({}).strict(),
    },
  },
};

export const getApiInputSchema = (
	pagePath: string,
	apiName: string,
	version: string,
): z.ZodTypeAny | undefined => {
	return apiInputSchemas[pagePath]?.[apiName]?.[version];
};
