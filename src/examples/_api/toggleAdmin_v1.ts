import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';

export const auth: AuthProps = {
  login: true,
};

export interface ApiParams {
  data: {};
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
  saveSession(user.token, updatedUser);

  return {
    status: 'success',
    result: {
      message: `Admin status toggled to: ${newAdminStatus}`,
      admin: newAdminStatus,
      previousStatus: user.admin
    }
  };
};
