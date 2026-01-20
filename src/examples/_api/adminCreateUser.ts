/**
 * Example Admin-only API
 * 
 * This API requires the user to be both logged in AND have admin: true.
 * Perfect for admin dashboards and privileged operations.
 */

import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { AuthProps, SessionLayout } from 'config';

// Schema for creating a new user (admin action)
export const schema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  isAdmin: z.boolean().optional().default(false),
});

type RequestData = z.infer<typeof schema>;

// Require admin privileges
export const auth: AuthProps = {
  login: true,
  additional: [
    { key: 'admin', value: true }
  ]
};

interface ApiParams {
  data: RequestData;
  functions: { prisma: PrismaClient;[key: string]: any };
  user: SessionLayout;
}

export const main = async ({ data, functions, user }: ApiParams) => {
  console.log(`Admin ${user.name} is creating a new user`);

  // In a real app, you would:
  // 1. Hash the password
  // 2. Check if email already exists
  // 3. Create the user in the database

  // const { prisma } = functions;
  // const newUser = await prisma.user.create({
  //   data: {
  //     email: data.email,
  //     name: data.name,
  //     password: await bcrypt.hash(data.password, 10),
  //     admin: data.isAdmin,
  //     provider: 'credentials'
  //   }
  // });

  return {
    status: 'success',
    result: {
      message: `User ${data.email} would be created by admin ${user.name}`,
      createdBy: user.id
    }
  };
};
