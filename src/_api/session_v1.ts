//? @adr 0018 — Session-bootstrap endpoint. The framework re-attaches the raw
//? `token` (and `csrfToken`) to the server-side `user`, but page JS must never
//? receive the token in cookie mode (it is the HttpOnly-cookie credential). This
//? route returns the CLIENT-facing `ClientSessionLayout` — the session WITHOUT
//? those server-only fields — so the token can't reach page JS by construction,
//? in either mode. The client already has what it needs: the socket handshake
//? reads the token from sessionStorage (token mode) or rides the cookie (cookie
//? mode), and the CSRF token is fetched separately from `/auth/csrf`. Do not add
//? `token` back here or cast around the type — see the ADR.
import { AuthProps, SessionLayout, ClientSessionLayout } from '../../config';
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
  if (!user) {
    return { status: 'success', result: null };
  }
  //? Strip the server-only credential fields before the session reaches page JS.
  const { token: _token, csrfToken: _csrfToken, ...clientSession } = user;
  const result: ClientSessionLayout = clientSession;
  return {
    status: 'success',
    result
  };
};
