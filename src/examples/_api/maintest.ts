/**
 * API Template
 * 
 * Define your input data in ApiParams.data interface.
 * The Zod schema and ApiResult will be auto-generated.
 */

import { AuthProps, SessionLayout } from '../../../config';

export const auth: AuthProps = {
  login: false,
};

export interface ApiParams {
  data: {
    name: string;
    email: string;
    test: number;
  };
  user: SessionLayout;
}

export const main = async ({ data, user }: ApiParams) => {
  return {
    status: 'success',
    result: {
      data,
      data2: data,
      name: data.name,
      name123: 123,
    }
  };
};

// ═══════════════════════════════════════════════════════════════════════════════
// @generated - Code below this line is auto-generated. Manual edits to the Zod
// schema are preserved (smart merge).
// ═══════════════════════════════════════════════════════════════════════════════

import { z } from 'zod';

export const schema = z.object({
  data: z.object({
    name: z.string()
      .min(1, { message: 'name is required' })
      .max(255, { message: 'name must be less than 255 characters' }),
    email: z.string()
      .email({ message: 'Invalid email format' })
      .min(1, { message: 'Email is required' }),
  })
});
