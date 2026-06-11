import { createHash } from 'node:crypto';
import { redis } from '@luckystack/core';
import { deleteSession } from '@luckystack/login';
import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';

export const rateLimit: number | false = 20;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';

export const auth: AuthProps = {
  login: true,
  additional: [],
};

export interface ApiParams {
  data: { id: string };
  user: SessionLayout;
  functions: Functions;
}

const PROJECT_NAME = process.env.PROJECT_NAME ?? 'luckystack';

export const main = async ({ data, user }: ApiParams): Promise<ApiResponse> => {
  const targetId = data.id;
  if (!targetId) {
    return { status: 'error', errorCode: 'session.invalid' };
  }

  //? Resolve the opaque SHA-256 id (from listSessions) back to a real token by
  //? scanning THIS user's own active-session set — so ownership is guaranteed by
  //? set membership and the raw token never has to leave the server.
  const tokens = await redis.smembers(`${PROJECT_NAME}-activeUsers:${user.id}`).catch(() => null);
  if (tokens === null) {
    return { status: 'error', errorCode: 'common.500' };
  }
  const targetToken = tokens.find(
    (token) => createHash('sha256').update(token).digest('hex') === targetId,
  );
  if (!targetToken) {
    return { status: 'error', errorCode: 'session.invalid' };
  }
  if (targetToken === user.token) {
    // Refuse to revoke the current session — the user must log out instead.
    return { status: 'error', errorCode: 'session.invalid' };
  }

  await deleteSession(targetToken);
  return { status: 'success', result: {} };
};
