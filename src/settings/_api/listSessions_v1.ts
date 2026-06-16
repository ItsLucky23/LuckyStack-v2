import { createHash } from 'node:crypto';
import { redis } from '@luckystack/core';
import { sessionKeyFor, activeUsersKeyFor } from '@luckystack/login';
import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';

export const rateLimit: number | false = 30;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';

export const auth: AuthProps = {
  login: true,
  additional: [],
};

export interface ApiParams {
  data: Record<string, never>;
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ user }: ApiParams): Promise<ApiResponse> => {
  //? Use the framework key builders (which route through `formatKey`) so a
  //? registered custom Redis key formatter — multi-tenancy / migration — reads
  //? the SAME keys @luckystack/login writes, instead of a hardcoded shape.
  const tokens = await redis.smembers(activeUsersKeyFor(user.id)).catch(() => null);
  if (tokens === null) {
    return { status: 'error', errorCode: 'common.500' };
  }

  const sessions = await Promise.all(tokens.map(async (token) => {
    const sessionKey = sessionKeyFor(token);
    const raw = await redis.get(sessionKey);
    if (!raw) return null;
    const ttl = await redis.ttl(sessionKey);
    return {
      //? Never expose the raw session token to the client — it IS the bearer
      //? credential. Send an opaque, non-reversible SHA-256 fingerprint instead;
      //? revokeSession resolves it back to the real token server-side.
      id: createHash('sha256').update(token).digest('hex'),
      expiresInSeconds: ttl >= 0 ? ttl : null,
      isCurrent: token === user.token,
    };
  }));

  return {
    status: 'success',
    result: { sessions: sessions.filter((s) => s !== null) },
  };
};
