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
  data: { token: string };
  user: SessionLayout;
  functions: Functions;
}

const PROJECT_NAME = process.env.PROJECT_NAME ?? 'luckystack';

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const targetToken = data.token;
  if (!targetToken || targetToken === user.token) {
    // Refuse to revoke the current session — the user must log out instead.
    return { status: 'error', errorCode: 'session.invalid' };
  }

  // Validate the target token belongs to this user.
  const sessionRaw = await redis.get(`${PROJECT_NAME}-session:${targetToken}`);
  if (!sessionRaw) {
    return { status: 'error', errorCode: 'session.invalid' };
  }

  const [parseError, parsed] = await functions.tryCatch.tryCatch(
    () => JSON.parse(sessionRaw) as { id?: string },
  );
  if (parseError || parsed?.id !== user.id) {
    return { status: 'error', errorCode: 'auth.forbidden' };
  }

  await deleteSession(targetToken);
  return { status: 'success', result: {} };
};
