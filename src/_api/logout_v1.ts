//? Intentional no-op SAFETY route. The REAL logout teardown runs through the
//? framework's built-in `system/logout` shortcut (the Navbar fires
//? `apiRequest({ name: 'system/logout' })`) plus the `/auth/logout` HTTP route —
//? NOT this route. This file exists so a stray `api/logout/v1` call returns a
//? clean success instead of 404; keep it as a harmless fallback, or add your own
//? logout-time side effects here and call it explicitly.
import { AuthProps, SessionLayout } from '../../config';
import { Functions, ApiResponse, MaybePromise } from '../_sockets/apiTypes.generated';

export const rateLimit: number | false = 30;

export const auth: AuthProps = {
  login: false,
};

export const httpMethod = 'DELETE' as const;

export interface ApiParams {
  data: Record<string, never>;
  user: SessionLayout | null;
  functions: Functions;
}

export const main = (): MaybePromise<ApiResponse> => {
  return {
    status: 'success',
    result: true
  };
};
