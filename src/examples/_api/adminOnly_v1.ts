import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse, MaybePromise } from '../../../src/_sockets/apiTypes.generated';

export const auth: AuthProps = {
  login: true,
  additional: [
    { key: 'admin', value: true }
  ]
};

export interface ApiParams {
  data: Record<string, never>;
  user: SessionLayout;
  functions: Functions;
}

export const main = ({ user }: ApiParams): MaybePromise<ApiResponse> => {
  return {
    status: 'success',
    result: {
      message: `Welcome Admin ${user.name}! This is a protected endpoint.`,
      adminInfo: {
        userId: user.id,
        email: user.email,
        isAdmin: true,
        accessedAt: new Date().toISOString()
      }
    }
  };
};
