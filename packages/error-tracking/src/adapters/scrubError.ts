//? Shared rebuild step for adapters whose SDK reads message/stack straight off
//? the Error it is given (Sentry, PostHog). The rebuilt Error carries only
//? scrubbed text, so an interpolated secret never reaches the vendor (ET-O2).

import { sanitizeErrorString, sanitizeErrorStrings } from '@luckystack/core';

//? Scalar code/status fields that are safe to keep and that grouping and
//? alerting rely on (provider and SMTP codes). Every other own property is
//? dropped: SDKs serialise them, and they can echo request data.
const SAFE_ERROR_FIELDS = ['code', 'responseCode', 'statusCode', 'status'] as const;

//? A cause chain is normally one or two links. The cap stops a cyclic or
//? pathological chain from recursing without end.
const MAX_CAUSE_DEPTH = 5;

const scrubCause = (cause: unknown, depth: number): Error | string | undefined => {
  if (depth >= MAX_CAUSE_DEPTH) return undefined;
  if (typeof cause === 'string') return sanitizeErrorString(cause);
  if (cause instanceof Error) return rebuildError(cause, depth);
  //? Any other shape has no scrub contract, so it is left out.
  return undefined;
};

const rebuildError = (error: Error, depth: number): Error => {
  const scrubbed = sanitizeErrorStrings(error);
  //? Keep `cause` on the rebuilt Error: SDKs report it as a linked exception,
  //? and @luckystack/email attaches a scrubbed provider cause on purpose.
  const cause = scrubCause(error.cause, depth + 1);
  const rebuilt = cause === undefined
    ? new Error(scrubbed?.message ?? error.message)
    : new Error(scrubbed?.message ?? error.message, { cause });
  rebuilt.name = error.name;
  rebuilt.stack = scrubbed?.stack ?? error.stack;
  for (const field of SAFE_ERROR_FIELDS) {
    const value: unknown = Reflect.get(error, field);
    if (typeof value === 'number') Reflect.set(rebuilt, field, value);
    if (typeof value === 'string') Reflect.set(rebuilt, field, sanitizeErrorString(value));
  }
  return rebuilt;
};

/**
 * Rebuild `error` with its message, stack and cause chain scrubbed of
 * interpolated secrets, keeping its name (type-based grouping) and a small
 * allow-list of scalar code fields.
 */
export const toScrubbedError = (error: Error): Error => rebuildError(error, 0);
