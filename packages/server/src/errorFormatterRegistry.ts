//? Error-response formatter registry. The framework normalizes errors via
//? `normalizeErrorResponse` (i18n + envelope shape). Consumers can register
//? a global formatter to add fields (e.g. supportTicketId, correlationId,
//? deprecated alias keys for legacy clients), or override per-endpoint by
//? exporting `errorFormatter` from an `_api/*.ts` or `_sync/*.ts` file.
//?
//? Resolution order at error time:
//?   1. Per-endpoint `errorFormatter` export (when the route file declares one).
//?   2. Global formatter from `registerErrorFormatter(...)`.
//?   3. Framework default `normalizeErrorResponse`.
//?
//? The per-endpoint hook is wired in api / sync handlers; this registry
//? only owns the global-default slot.

export interface ErrorFormatterContext {
  /** Resolved route name (`api/billing/getInvoice/v1`, `sync/...`). */
  routeName: string;
  /** Transport that triggered the error. */
  transport: 'socket' | 'http';
  /** Session id when available. */
  userId?: string | null;
}

export type ErrorFormatter = (
  error: { status: 'error'; errorCode: string; message?: string; httpStatus?: number; [key: string]: unknown },
  ctx: ErrorFormatterContext,
) => Record<string, unknown>;

let activeFormatter: ErrorFormatter | null = null;

/**
 * Register a global error-response formatter. Receives the normalized
 * error envelope + context; return a (possibly extended) object that the
 * framework will emit. Pass `null` to unregister.
 *
 * For per-endpoint overrides, export `errorFormatter` from your
 * `_api/foo_v1.ts` file directly — the api handler imports + invokes it.
 */
export const registerErrorFormatter = (formatter: ErrorFormatter | null): void => {
  activeFormatter = formatter;
};

/** Read the active global formatter (or null). */
export const getErrorFormatter = (): ErrorFormatter | null => activeFormatter;
