/* eslint-disable */
//? Playground: simple echo. Returns the message sent + the caller's session
//? id + a server-side timestamp. Used by the playground page's "API echo"
//? button to confirm round-trip latency and that the framework's request
//? plumbing is intact.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse, MaybePromise } from '../../_sockets/apiTypes.generated';

export const rateLimit: number | false = 60;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';

export const auth: AuthProps = {
  login: false,
};

export interface ApiParams {
  data: { message: string };
  user: SessionLayout | null;
  functions: Functions;
}

export const main = ({ data, user }: ApiParams): MaybePromise<ApiResponse> => {
  return {
    status: 'success',
    result: {
      echoed: data.message,
      receivedAt: new Date().toISOString(),
      sessionId: user?.id ?? null,
    },
  };
};
