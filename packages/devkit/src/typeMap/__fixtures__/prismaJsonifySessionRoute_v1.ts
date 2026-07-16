//? Regression for the real scaffold shape: SessionLayout wraps a Prisma model
//? in core's Jsonify<T>. Prisma JsonValue is self-recursive and must remain an
//? identity boundary while Date still projects to string.
import type { Jsonify } from '@luckystack/core';
import type { JsonValue } from '@prisma/client/runtime/library.js';

type PrismaSession = Jsonify<{
  id: string;
  preferences: JsonValue;
  createdAt: Date;
  lastLogin: Date | null;
}>;

export interface ApiParams {
  data: Record<string, never>;
}

export const main = async (_params: ApiParams): Promise<{
  status: 'success';
  result: PrismaSession;
}> => {
  await Promise.resolve();
  let result!: PrismaSession;
  return { status: 'success', result };
};
