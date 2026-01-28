import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';

export const auth: AuthProps = {
  login: true,
  additional: [
    { key: 'admin', value: true }
  ]
};

export interface ApiParams {
  data: {};
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ user }: ApiParams): Promise<ApiResponse> => {
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