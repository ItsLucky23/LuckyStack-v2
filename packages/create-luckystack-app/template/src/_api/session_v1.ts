import { AuthProps, SessionLayout } from '../../config';
import { Functions, ApiResponse, MaybePromise } from '../_sockets/apiTypes.generated';

export const rateLimit: number | false = 60;

export const auth: AuthProps = {
  login: false
};

export interface ApiParams {
  data: Record<string, never>;
  user: SessionLayout | null;
  functions: Functions;
}

export const main = ({ user }: ApiParams): MaybePromise<ApiResponse> => {
  if (!user) return { status: 'success', result: null };
  //? Strip server-only credential fields before returning the session to the
  //? browser. `token` is the raw session credential — in the default mode it's an
  //? HttpOnly cookie precisely so client JS can NOT read it (XSS protection), so
  //? returning it here would defeat that. `csrfToken` is a CSRF secret attached at
  //? runtime by @luckystack/login (not declared on SessionLayout, hence the
  //? widening) with its own delivery channel (GET /auth/csrf). The frontend only
  //? needs the non-secret session info (id, name, email, roles, roomCodes, ...).
  const { token: _stripToken, csrfToken: _stripCsrf, ...safe } = user as SessionLayout & { csrfToken?: string };
  return { status: 'success', result: safe };
};
