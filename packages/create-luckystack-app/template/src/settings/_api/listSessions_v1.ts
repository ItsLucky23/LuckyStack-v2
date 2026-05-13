import { redis } from '@luckystack/core';
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

const PROJECT_NAME = process.env.PROJECT_NAME ?? 'luckystack';

export const main = async ({ user }: ApiParams): Promise<ApiResponse> => {
  const activeKey = `${PROJECT_NAME}-activeUsers:${user.id}`;
  const tokens = await redis.smembers(activeKey).catch(() => null);
  if (tokens === null) {
    return { status: 'error', errorCode: 'common.500' };
  }

  const sessions = await Promise.all(tokens.map(async (token) => {
    const raw = await redis.get(`${PROJECT_NAME}-session:${token}`);
    if (!raw) return null;
    const ttl = await redis.ttl(`${PROJECT_NAME}-session:${token}`);
    return {
      token,
      expiresInSeconds: ttl >= 0 ? ttl : null,
      isCurrent: token === user.token,
    };
  }));

  return {
    status: 'success',
    result: { sessions: sessions.filter((s) => s !== null) },
  };
};
