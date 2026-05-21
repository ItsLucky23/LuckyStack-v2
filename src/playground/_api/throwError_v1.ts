//? Playground: deliberately throws so the framework's apiError hook fires
//? and the response normalizer maps the throw into a `{ status: 'error',
//? errorCode: 'api.internalServerError' }` envelope. Used to demonstrate
//? hook surface visibly.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse, MaybePromise } from '../../_sockets/apiTypes.generated';

export const rateLimit: number | false = 60;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';

export const auth: AuthProps = {
  login: false,
};

export interface ApiParams {
  data: {
    mode?: 'throw' | 'returnError';
    /** Custom error code returned when mode === 'returnError'. */
    errorCode?: string;
  };
  user: SessionLayout | null;
  functions: Functions;
}

export const main = ({ data }: ApiParams): MaybePromise<ApiResponse> => {
  const mode = data.mode ?? 'throw';
  if (mode === 'returnError') {
    return {
      status: 'error',
      errorCode: data.errorCode ?? 'playground.simulatedError',
    };
  }
  //? Uncaught throw — handleApiRequest catches, dispatches `apiError`, and
  //? normalizes to `api.internalServerError`. Sentry captures via the
  //? framework's auto-capture path.
  throw new Error(`Playground throwError_v1: deliberate failure (mode=${mode}).`);
};
