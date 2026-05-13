import type { Prisma } from '@prisma/client';

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';

export const rateLimit: number | false = 30;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';

export const auth: AuthProps = {
  login: true,
  additional: [],
};

export interface UserPreferences {
  notifyOnNewSignIn?: boolean;
  notifyOnPasswordChange?: boolean;
}

export interface ApiParams {
  data: { preferences: UserPreferences };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const incoming = data.preferences;
  // Allow-list to prevent arbitrary keys from being saved.
  const sanitized: UserPreferences = {
    notifyOnNewSignIn: typeof incoming.notifyOnNewSignIn === 'boolean' ? incoming.notifyOnNewSignIn : undefined,
    notifyOnPasswordChange: typeof incoming.notifyOnPasswordChange === 'boolean' ? incoming.notifyOnPasswordChange : undefined,
  };

  const updated = await functions.db.prisma.user.update({
    where: { id: user.id },
    data: { preferences: sanitized as unknown as Prisma.InputJsonValue },
  }).catch(() => null);

  if (!updated) {
    return { status: 'error', errorCode: 'common.500' };
  }

  if (user.token) {
    //? Bind to a local first so the object literal isn't subject to excess
    //? property checks against `BaseSessionLayout` — `preferences` lives on
    //? the project's extended `SessionLayout`, not the framework shape.
    const merged = { ...user, preferences: updated.preferences };
    await functions.session.saveSession(user.token, merged);
  }

  return { status: 'success', result: { preferences: sanitized } };
};
