/* eslint-disable */
//? Playground: low rate-limit endpoint for demoing the rate-limiter. Hit it
//? rapidly from the playground page (the "Spam playground/spam" button
//? fires 10 calls in a tight loop). After the 3rd call inside the window,
//? the framework returns `rateLimit.exceeded` and dispatches the
//? `rateLimitExceeded` hook server-side.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse, MaybePromise } from '../../_sockets/apiTypes.generated';

export const rateLimit: number | false = 3;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';

export const auth: AuthProps = {
  login: false,
};

export interface ApiParams {
  data: Record<string, never>;
  user: SessionLayout | null;
  functions: Functions;
}

export const main = ({ user }: ApiParams): MaybePromise<ApiResponse> => {
  return {
    status: 'success',
    result: {
      ok: true,
      at: new Date().toISOString(),
      sessionId: user?.id ?? null,
    },
  };
};
