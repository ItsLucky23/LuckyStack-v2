/**
 * Toggle Admin Status API
 * 
 * Toggles the current user's admin status (admin = !admin).
 * Requires the user to be logged in.
 */

import { PrismaClient } from '@prisma/client';
import { AuthProps, SessionLayout } from 'config';

export const auth: AuthProps = {
  login: true,
};

interface ApiParams {
  data: Record<string, any>;
  functions: { prisma: PrismaClient; saveSession: any;[key: string]: any };
  user: SessionLayout;
}

export const main = async ({ functions, user }: ApiParams) => {
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
