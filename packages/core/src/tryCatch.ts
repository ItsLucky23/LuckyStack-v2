import { captureException } from './sentrySetup';

export default async function tryCatch<T, P>(
  func: (values: P) => Promise<T> | T,
  params?: P,
  context?: Record<string, unknown>
): Promise<[Error | null, T | null]> {
  try {
    const response = await func(params as P);
    return [null, response];
  } catch (error) {
    captureException(error, context);
    return [error as Error, null];
  }
}
