/**
 * Admin Only API
 * 
 * This API can ONLY be called by users with admin: true.
 * Use this for privileged operations.
 */

import { AuthProps, SessionLayout } from 'config';

export const auth: AuthProps = {
  login: true,
  additional: [
    { key: 'admin', value: true }
  ]
};

interface ApiParams {
  data: Record<string, any>;
  user: SessionLayout;
}

export const main = async ({ user }: ApiParams) => {
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
