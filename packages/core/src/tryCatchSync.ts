//? Synchronous sibling of `tryCatch`. The async `tryCatch` returns a Promise
//? and auto-captures to the error tracker — neither of which fits a hot,
//? genuinely-synchronous path (error-formatter dispatch, cookie/CSRF parse)
//? that must stay synchronous and decides its own logging.
//?
//? Unlike the async `tryCatch`, this helper does NOT auto-capture to the
//? error tracker: the call sites that need it are synchronous fallbacks that
//? already do their own contextual logging and deliberately keep the error
//? path side-effect-light. Capture explicitly on the error tuple when needed.

export default function tryCatchSync<T, P>(
  func: (values: P) => T,
  params?: P,
): [Error | null, T | null] {
  try {
    const response = func(params as P);
    return [null, response];
  } catch (error) {
    return [error as Error, null];
  }
}
