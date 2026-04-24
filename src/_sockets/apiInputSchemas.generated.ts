/* eslint-disable */
//? Auto-generated Zod schemas for every API input. Driven by the same walk
//? as apiTypes.generated.ts; see @luckystack/devkit/src/typeMap/zodEmitter.ts
//? for the TS-AST → Zod converter. Types that fall outside the converter's
//? scope emit `z.any()` with a TODO comment.

import { z } from 'zod';

export const apiInputSchemas: Record<string, Record<string, Record<string, z.ZodTypeAny>>> = {
  'settings': {
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
