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

  //? Read the current preferences from the DB rather than the session to avoid
  //? clobbering any keys written by a concurrent request or future additions
  //? not yet reflected in the session object.
  const existing = await functions.db.prisma.user.findUnique({
    where: { id: user.id },
    select: { preferences: true },
  });
  const raw = existing?.preferences ?? null;
  //? Treat any non-object JSON value (array, primitive, null) as an empty record so the
  //? merge below is always safe to spread.
  const existingPrefs: Record<string, unknown> =
    raw !== null && typeof raw === 'object' && !Array.isArray(raw)
      ? raw
      : {};

  // Allow-list to prevent arbitrary keys from being saved. Skip undefined values
  // entirely so the Prisma JSON column never receives a non-JSON-serializable value.
  //? Merge with existing so unknown/future preference keys are preserved.
  //? Typed boolean-valued for the Prisma JSON write (the schema's preference keys are
  //? all booleans); the spread still preserves any unknown/future keys at runtime.
  const sanitized: Record<string, boolean> = { ...(existingPrefs as Record<string, boolean>) };
  if (typeof incoming.notifyOnNewSignIn === 'boolean') sanitized.notifyOnNewSignIn = incoming.notifyOnNewSignIn;
  if (typeof incoming.notifyOnPasswordChange === 'boolean') sanitized.notifyOnPasswordChange = incoming.notifyOnPasswordChange;

  const updated = await functions.db.prisma.user.update({
    where: { id: user.id },
    data: { preferences: sanitized },
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
