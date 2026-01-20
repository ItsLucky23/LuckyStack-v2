/**
 * Zod validation utilities for API request data validation.
 * 
 * When enabled via config.enableZodValidation, API handlers can export
 * an optional `schema` that will be used to validate incoming data.
 * 
 * @example
 * ```typescript
 * // In your API file (e.g., src/settings/_api/updateProfile.ts)
 * import { z } from 'zod';
 * 
 * export const schema = z.object({
 *   name: z.string().min(1).max(100),
 *   email: z.string().email()
 * });
 * 
 * export const auth = { login: true };
 * 
 * export const main = async ({ data, user, functions }) => {
 *   // data is guaranteed to match the schema!
 *   const { name, email } = data;
 *   return { status: 'success' };
 * };
 * ```
 */

import { z, ZodSchema, ZodError } from 'zod';

export interface ValidationResult<T> {
  status: 'success' | 'error';
  data?: T;
  message?: string;
  errors?: Array<{ field: string; message: string }>;
}

/**
 * Validate data against a Zod schema.
 * 
 * @param schema - The Zod schema to validate against
 * @param data - The data to validate
 * @returns ValidationResult with either the validated data or error details
 */
export const validateWithSchema = <T>(
  schema: ZodSchema<T>,
  data: unknown
): ValidationResult<T> => {
  try {
    const validatedData = schema.parse(data);
    return {
      status: 'success',
      data: validatedData
    };
  } catch (error) {
    if (error instanceof ZodError) {
      return {
        status: 'error',
        message: 'Validation failed',
        errors: error.errors.map(e => ({
          field: e.path.join('.'),
          message: e.message
        }))
      };
    }
    return {
      status: 'error',
      message: 'Unknown validation error'
    };
  }
};

/**
 * Check if a value is a valid Zod schema.
 */
export const isZodSchema = (value: unknown): value is ZodSchema => {
  return value !== null &&
    typeof value === 'object' &&
    '_def' in value &&
    typeof (value as any).parse === 'function';
};

// Re-export Zod for convenience
export { z };
