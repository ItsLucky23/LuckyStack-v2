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

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const { prisma, saveSession } = functions;

  // Toggle admin status
  const newAdminStatus = !user.admin;

  // Update in database
  await prisma.user.update({
    where: { id: user.id },
    data: { admin: newAdminStatus }
  });

  // Update session
  const updatedUser = { ...user, admin: newAdminStatus };
  await saveSession(user.token, updatedUser);

  return {
    status: 'success',
    result: {
      message: `Admin status toggled to: ${newAdminStatus}`,
      admin: newAdminStatus,
      previousStatus: user.admin
    }
  };
};