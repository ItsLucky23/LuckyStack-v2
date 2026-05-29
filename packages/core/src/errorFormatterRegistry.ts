//? Error-response formatter registry — lives in core so transport handlers
//? in @luckystack/api and @luckystack/sync can dispatch the per-route /
//? global formatter without depending back up on @luckystack/server (which
//? would create a dependency cycle).
//?
//? The framework normalizes errors via `normalizeErrorResponse` (i18n +
//? envelope shape). Consumers can register a global formatter to add
//? fields (e.g. supportTicketId, correlationId, deprecated alias keys for
//? legacy clients), or override per-endpoint by exporting `errorFormatter`
//? from an `_api/*.ts` or `_sync/*.ts` file — the api/sync handlers read
//? that export off the runtime apiEntry/syncEntry and apply it through
//? `applyErrorFormatter` below.
//?
//? Resolution order at error time:
//?   1. Per-endpoint `errorFormatter` export (when the route file declares one).
//?   2. Global formatter from `registerErrorFormatter(...)`.
//?   3. Framework default `normalizeErrorResponse`.
//?
//? @luckystack/server re-exports `registerErrorFormatter` + types from
//? here for backward compatibility — `import { registerErrorFormatter }
//? from '@luckystack/server'` continues to work.

export interface ErrorFormatterContext {
  /** Resolved route name (`api/billing/getInvoice/v1`, `sync/...`). */
  routeName: string;
  /** Transport that triggered the error. */
  transport: 'socket' | 'http';
  /** Session id when available. */
  userId?: string | null;
}

export type ErrorFormatter = (
  error: { status: 'error'; errorCode?: string; message?: string; httpStatus?: number; [key: string]: unknown },
  ctx: ErrorFormatterContext,
) => Record<string, unknown>;

let activeFormatter: ErrorFormatter | null = null;

/**
 * Register a global error-response formatter. Receives the normalized
 * error envelope + context; return a (possibly extended) object that the
 * framework will emit. Pass `null` to unregister.
 *
 * For per-endpoint overrides, export `errorFormatter` from your
 * `_api/foo_v1.ts` file directly — the api/sync handler imports + invokes
 * it through `applyErrorFormatter`.
 */
export const registerErrorFormatter = (formatter: ErrorFormatter | null): void => {
  activeFormatter = formatter;
};

/** Read the active global formatter (or null). */
export const getErrorFormatter = (): ErrorFormatter | null => activeFormatter;

/**
 * Apply per-route → global → identity formatter chain to a normalized
 * error envelope. Returns the envelope unchanged when `status !== 'error'`
 * so it's safe to wrap every emit call. Errors thrown inside a formatter
 * are caught and logged; the un-formatted envelope is returned in that
 * case to keep the error path crash-resistant.
 */
export const applyErrorFormatter = (input: {
  response: Record<string, unknown> & { status?: string };
  routeName: string;
  transport: 'socket' | 'http';
  userId?: string | null;
  perRouteFormatter?: ErrorFormatter | undefined | null;
}): Record<string, unknown> => {
  const { response, routeName, transport, userId, perRouteFormatter } = input;
  if (response.status !== 'error') return response;

  const ctx: ErrorFormatterContext = { routeName, transport, userId };
  const errorEnvelope = response as { status: 'error'; errorCode?: string; message?: string; httpStatus?: number; [key: string]: unknown };

  if (perRouteFormatter) {
    try {
      return perRouteFormatter(errorEnvelope, ctx);
    } catch (error) {
      console.error(`[errorFormatter] per-route formatter for ${routeName} threw:`, error);
      //? Fall through to global / identity so the error path stays resilient.
    }
  }

  const globalFormatter = activeFormatter;
  if (globalFormatter) {
    try {
      return globalFormatter(errorEnvelope, ctx);
    } catch (error) {
      console.error(`[errorFormatter] global formatter threw on ${routeName}:`, error);
      return response;
    }
  }

  return response;
};
