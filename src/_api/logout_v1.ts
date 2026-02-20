import { AuthProps, SessionLayout } from '../../config';
import { Functions, ApiResponse } from '../_sockets/apiTypes.generated';

export const auth: AuthProps = {
  login: false,
};

export const httpMethod = 'DELETE' as const;

export interface ApiParams {
  data: {};
  user: SessionLayout | null;
  functions: Functions;
}

export const main = async (_params: ApiParams): Promise<ApiResponse> => {
  return {
    status: 'success',
    result: true
  };
};
