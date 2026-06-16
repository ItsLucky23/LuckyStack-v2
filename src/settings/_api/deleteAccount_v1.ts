import { redis } from '@luckystack/core';
import { revokeUserSessions, verifyPassword, activeUsersKeyFor } from '@luckystack/login';
import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';

export const rateLimit: number | false = 3;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';

export const auth: AuthProps = {
  login: true,
  additional: [],
};

export interface ApiParams {
  data: { confirmation: string; password?: string };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  if (data.confirmation !== 'DELETE') {
    return { status: 'error', errorCode: 'auth.forbidden' };
  }

  // Credentials accounts must reconfirm with their password.
  const dbUser = await functions.db.prisma.user.findUnique({ where: { id: user.id } });
  if (dbUser?.password) {
    const ok = data.password ? await verifyPassword(data.password, dbUser.password) : false;
    if (!ok) {
      return { status: 'error', errorCode: 'login.wrongPassword' };
    }
  }

  // Wipe every session (including current — the user IS being deleted). Use the
  // framework key builder so a registered custom Redis key formatter is honored.
  await revokeUserSessions(user.id);
  await redis.del(activeUsersKeyFor(user.id));

  await functions.db.prisma.user.delete({ where: { id: user.id } });
  return { status: 'success', result: {} };
};
