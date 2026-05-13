//? Client-safe tryCatch. Returns a [error, result] tuple — first value
//? truthy on failure, second on success. No Sentry coupling here; if you
//? want errors auto-captured, wire your error-tracking adapter and call
//? `captureException` inside the catch (see @luckystack/error-tracking).

export default async function tryCatch<T, P>(
  func: (values: P) => Promise<T> | T,
  params?: P,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _context?: Record<string, unknown>,
): Promise<[Error | null, T | null]> {
  try {
    const response = await func(params as P);
    return [null, response];
  } catch (error) {
    return [error as Error, null];
  }
}
