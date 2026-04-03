import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';

export const auth: AuthProps = {
  login: true,
};

export interface ApiParams {
  data: Record<string, never>;
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ user, functions }: ApiParams): Promise<ApiResponse> => {
  const { db: { prisma }, session: { saveSession } } = functions;

  const newAdminStatus = !user.admin;

  await prisma.user.update({
    where: { id: user.id },
    data: { admin: newAdminStatus }
  });

  const updatedUser = { ...user, admin: newAdminStatus };
  await saveSession(user.token, updatedUser);

  return {
    status: 'success',
    result: {
      message: newAdminStatus ? 'Admin status toggled to: true' : 'Admin status toggled to: false',
      admin: newAdminStatus,
      previousStatus: user.admin
    }
  };
};
