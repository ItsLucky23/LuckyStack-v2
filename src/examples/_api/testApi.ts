/**
 * Example API with Zod Validation
 * 
 * This demonstrates how to use Zod schemas for request validation.
 * When `config.enableZodValidation` is true, the schema is automatically
 * validated before the main function is called.
 */

import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { AuthProps, SessionLayout } from 'config';

// ============================================
// ZOD SCHEMA (Optional - for request validation)
// ============================================
// Export a `schema` to enable automatic validation.
// If validation fails, the request returns an error before main() runs.

export const schema = z.object({
  // Required string with constraints
  name: z.string()
    .min(1, 'Name is required')
    .max(100, 'Name must be 100 characters or less'),

  // Required email with format validation
  email: z.string()
    .email('Invalid email format'),

  // Optional number with constraints  
  age: z.number()
    .int('Age must be a whole number')
    .positive('Age must be positive')
    .optional(),

  // Optional array of strings
  tags: z.array(z.string()).optional(),

  // Optional enum
  role: z.enum(['user', 'admin', 'moderator']).optional(),
});

// TypeScript type inferred from schema
type RequestData = z.infer<typeof schema>;

// ============================================
// AUTH CONFIG
// ============================================

interface Functions {
  prisma: PrismaClient;
  saveSession: (sessionId: string, data: any) => Promise<boolean>;
  getSession: (sessionId: string) => Promise<any | null>;
  deleteSession: (sessionId: string) => Promise<boolean>;
  tryCatch: <T, P>(func: (values: P) => Promise<T> | T, params?: P) => Promise<[any, T | null]>;
  [key: string]: any;
};

interface ApiParams {
  data: RequestData;  // Type-safe thanks to Zod!
  functions: Functions;
  user: SessionLayout;
};

export const auth: AuthProps = {
  login: true,
  // additional: [
  //   { key: 'admin', value: true },  // Require admin
  // ]
};

// ============================================
// MAIN HANDLER
// ============================================

export const main = async ({ data, functions, user }: ApiParams) => {
  // Data is already validated by Zod at this point!
  console.log('Validated data:', data);
  console.log('User:', user.name, user.email);

  // Safe to use - Zod guarantees these exist and have correct types
  const { name, email, age, tags, role } = data;

  return {
    status: 'success',
    result: {
      message: `Hello ${name}!`,
      email,
      age: age ?? 'not provided',
      tags: tags ?? [],
      role: role ?? 'user'
    }
  };
};