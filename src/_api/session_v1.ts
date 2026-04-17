import { AuthProps, SessionLayout } from '../../config';
import { Functions, ApiResponse, MaybePromise } from '../_sockets/apiTypes.generated';

export const auth: AuthProps = {
  login: false
};

export interface ApiParams {
  data: Record<string, never>;
  user: SessionLayout | null;
  functions: Functions;
}

export const main = ({ user }: ApiParams): MaybePromise<ApiResponse> => {
  console.log(user);
  return {
    status: 'success',
    result: user
  };
};
