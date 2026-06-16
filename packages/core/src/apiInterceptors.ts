//? EXT-03 — client-side request/response interceptor registry for `apiRequest`.
//?
//? `apiRequest` (apiRequest.ts) is a monolithic typed function and Rule 21 /
//? the `no-unsafe-api-wrappers` lint forbid wrapping it (a wrapper erases the
//? route/version inference). This registry is the sanctioned escape hatch: a
//? consumer registers an interceptor here instead of wrapping the call, so the
//? typed call site is untouched and route/version inference survives.
//?
//? Two seams, both fire-and-mutate (NOT replace — the dispatcher reserves a
//? structured return for control flow):
//?   - request interceptors run just before the socket emit. A handler may
//?     mutate `ctx.data` in place (inject a correlation id / feature-flag
//?     context / tenant header-equivalent) and is observation-only otherwise.
//?   - response interceptors run when the response envelope arrives, before the
//?     awaiting caller resolves. Observation-only (metrics, breadcrumb, custom
//?     logging). The envelope is NOT mutated by this seam — response rewriting
//?     belongs on the server `preApiRespond` / `transformApiResponse` hooks.
//?
//? Handlers are best-effort: a throw / rejection is caught + logged and never
//? breaks the request pipeline. Both `register*` functions return an
//? unsubscribe closure, matching `registerClientHook`'s contract.

export interface ApiRequestInterceptorContext {
  /** Resolved route name (`<page>/<api>` or `system/<api>`). */
  name: string;
  /** Route version literal (e.g. `'v1'`). */
  version: string;
  /**
   * Outgoing request payload. Mutate this object in place to augment the
   * request (correlation id, feature-flag context, ...). Replacing the
   * reference has no effect — mutate keys on the existing object.
   */
  data: Record<string, unknown>;
}

export interface ApiResponseInterceptorContext {
  name: string;
  version: string;
  /** The response envelope the caller is about to receive (read-only intent). */
  response: { status: 'success' | 'error'; [key: string]: unknown };
}

export type ApiRequestInterceptor = (
  ctx: ApiRequestInterceptorContext,
) => void | Promise<void>;

export type ApiResponseInterceptor = (
  ctx: ApiResponseInterceptorContext,
) => void | Promise<void>;

const requestInterceptors = new Set<ApiRequestInterceptor>();
const responseInterceptors = new Set<ApiResponseInterceptor>();

/**
 * Register an outgoing-request interceptor. Returns an unsubscribe function.
 * Multiple interceptors run in registration order; each may mutate `ctx.data`.
 */
export function registerApiRequestInterceptor(interceptor: ApiRequestInterceptor): () => void {
  requestInterceptors.add(interceptor);
  return () => {
    requestInterceptors.delete(interceptor);
  };
}

/**
 * Register an incoming-response interceptor. Returns an unsubscribe function.
 */
export function registerApiResponseInterceptor(interceptor: ApiResponseInterceptor): () => void {
  responseInterceptors.add(interceptor);
  return () => {
    responseInterceptors.delete(interceptor);
  };
}

//? Framework-internal — invoked by `apiRequest`. Awaited so a handler can do an
//? async lookup (read a flag store, mint a trace id) before the emit. Snapshot
//? the set so a handler unregistering mid-dispatch can't skip a sibling.
export async function dispatchApiRequestInterceptors(
  ctx: ApiRequestInterceptorContext,
): Promise<void> {
  if (requestInterceptors.size === 0) return;
  //? Snapshot so a handler that unregisters itself (or a sibling) mid-dispatch
  //? doesn't skip an un-visited handler.
  const interceptors = [...requestInterceptors];
  for (const interceptor of interceptors) {
    try {
      await interceptor(ctx);
    } catch (error) {
      console.error('[apiRequestInterceptor] handler threw:', error);
    }
  }
}

//? Framework-internal — invoked by `apiRequest` when the response arrives.
//? Fire-and-forget (the caller does not await) so an interceptor can't delay
//? the resolve; async rejections are caught + logged.
export function dispatchApiResponseInterceptors(
  ctx: ApiResponseInterceptorContext,
): void {
  if (responseInterceptors.size === 0) return;
  //? Snapshot (see `dispatchApiRequestInterceptors`).
  const interceptors = [...responseInterceptors];
  for (const interceptor of interceptors) {
    try {
      const result = interceptor(ctx);
      if (result && typeof (result as Promise<unknown>).catch === 'function') {
        (result as Promise<unknown>).catch((error: unknown) => {
          console.error('[apiResponseInterceptor] async handler rejected:', error);
        });
      }
    } catch (error) {
      console.error('[apiResponseInterceptor] handler threw:', error);
    }
  }
}

/** Test helper — drop every registered interceptor. Not part of the public API. */
export function _resetApiInterceptorsForTests(): void {
  requestInterceptors.clear();
  responseInterceptors.clear();
}
