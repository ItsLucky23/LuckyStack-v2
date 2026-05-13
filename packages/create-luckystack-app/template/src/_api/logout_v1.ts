import { AuthProps, SessionLayout } from '../../config';
import { Functions, ApiResponse, MaybePromise } from '../_sockets/apiTypes.generated';

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
