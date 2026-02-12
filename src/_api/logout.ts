import { AuthProps, SessionLayout } from '../../config';
import { Functions, ApiResponse } from '../_sockets/apiTypes.generated';

export const auth: AuthProps = {
  login: false,
};

// Mark as DELETE method for HTTP requests
export const httpMethod = 'DELETE' as const;

export interface ApiParams {
  data: {};
  user: SessionLayout | null;
  functions: Functions;
}

export const main = async (_params: ApiParams): Promise<ApiResponse> => {
  // We dont actually do anything here, logout is handled in handleApiRequest
  // We still define the api route so our type system knows about it
  return {
    status: 'success',
    result: true
  };
};
