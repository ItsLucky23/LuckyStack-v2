//? Client-side CSRF helper. Lazily fetches and caches the session's CSRF
//? token from `/auth/csrf`, then attaches it as `x-csrf-token` on
//? subsequent HTTP fetches in cookie mode.
//?
//? Token-mode sessions are CSRF-immune because cross-origin POSTs do not
//? auto-attach the sessionStorage value; the cache simply stays empty in
//? that mode.

import { getCsrfConfig } from './csrfConfig';
import { getProjectConfig } from './projectConfig';
import { socket } from './socketState';
import tryCatch from './tryCatch';
import tryCatchSync from './tryCatchSync';

//? Tokens are scoped to the HTTP invocation origin. In routed-http mode the
//? Socket.io connection may terminate on a remote `system` service while the
//? invocation goes same-origin through a local router; a single socket-derived
//? cache would fetch the CSRF token from the wrong ingress.
const cachedTokens = new Map<string, string>();
const inflightFetches = new Map<string, Promise<string | null>>();

const resolveSocketOrigin = (): string => socket?.io.opts.hostname
  ? `${socket.io.opts.secure ? 'https' : 'http'}://${socket.io.opts.hostname}${socket.io.opts.port ? `:${socket.io.opts.port}` : ''}`
  : '';

const resolveRequestOrigin = (input?: RequestInfo | URL): string => {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- SSR runtime guard
  const browserOrigin = globalThis.window !== undefined && globalThis.location?.origin
    ? globalThis.location.origin
    : '';
  if (input !== undefined) {
    let raw: string;
    if (typeof input === 'string') raw = input;
    else if (input instanceof URL) raw = input.href;
    else raw = input.url;
    const fallbackOrigin = browserOrigin.length > 0 ? browserOrigin : resolveSocketOrigin();
    const [error, parsed] = tryCatchSync(() => new URL(raw, fallbackOrigin));
    if (!error && parsed) return parsed.origin;
  }
  return browserOrigin.length > 0 ? browserOrigin : resolveSocketOrigin();
};

const fetchCsrfToken = async (origin: string): Promise<string | null> => {
  const base = origin;
  const [error, token] = await tryCatch<string | null, undefined>(async () => {
    const response = await fetch(`${base}/auth/csrf`, {
      method: 'GET',
      credentials: 'include',
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { csrfToken?: string | null };
    return body.csrfToken ?? null;
  });
  if (error) return null;
  return token ?? null;
};

/**
 * Fetch (or return the cached) CSRF token for the active session. Returns
 * null in token mode or when no session exists. Callers should attach the
 * returned value as the `X-CSRF-Token` request header.
 */
export const getCsrfToken = async (origin = resolveRequestOrigin()): Promise<string | null> => {
  //? Token-mode sessions: skip entirely. The server doesn't enforce CSRF
  //? in token mode, and there's no value to attach.
  if (getProjectConfig().session.basedToken) {
    return null;
  }

  const cached = cachedTokens.get(origin);
  if (cached) return cached;
  const inflight = inflightFetches.get(origin);
  if (inflight) return inflight;

  const next = fetchCsrfToken(origin).then((token) => {
    if (token) cachedTokens.set(origin, token);
    inflightFetches.delete(origin);
    return token;
  });
  inflightFetches.set(origin, next);
  return next;
};

/** Drop the cached token. Call this on logout or when a 403 csrfMismatch is seen. */
export const clearCsrfToken = (): void => {
  cachedTokens.clear();
  inflightFetches.clear();
};

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const isCsrfMismatchResponse = async (response: Response): Promise<boolean> => {
  if (response.status !== 403) return false;
  const [error, isMismatch] = await tryCatch<boolean, undefined>(async () => {
    //? `response.clone()` is used here so the ORIGINAL response body stream is
    //? preserved for the caller (the clone is consumed, the original is not).
    //? This is important: `httpFetch` returns the original `response` reference
    //? to the caller so it can read its body, and cloning before reading is the
    //? correct way to peek at the body without consuming it.
    const cloned = response.clone();
    const body = (await cloned.json()) as { errorCode?: string };
    return body.errorCode === 'auth.csrfMismatch';
  });
  if (error) return false;
  return isMismatch ?? false;
};

/**
 * Drop-in replacement for `fetch` that automatically attaches the framework's
 * `X-CSRF-Token` and `X-Request-Id` headers to state-changing requests in
 * cookie mode. Use this for any project-side HTTP call that hits a
 * LuckyStack `/api/*`, `/sync/*`, or `/auth/api/*` endpoint.
 *
 * Behavior:
 *   - GET / OPTIONS / HEAD: passes through without CSRF (read-only).
 *   - Token mode: passes through without CSRF (immune by design).
 *   - Cookie mode + state-changing method: lazily fetches `/auth/csrf` once,
 *     caches, attaches as `x-csrf-token`. On a 403 `auth.csrfMismatch`
 *     response, clears the cache and retries once.
 *   - `credentials: 'include'` is forced unless the caller overrode it.
 *
 * @example
 *   import { httpFetch } from '@luckystack/core/client';
 *   const res = await httpFetch('/api/system/myRoute/v1', {
 *     method: 'POST',
 *     body: JSON.stringify({ ... }),
 *   });
 */
export const httpFetch: typeof fetch = async (input, init = {}) => {
  const method = (init.method ?? 'GET').toUpperCase();
  const headers = new Headers(init.headers);
  const config = getProjectConfig();
  if (config.session.basedToken && !headers.has('Authorization')) {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- SSR runtime guard
    const token = globalThis.window === undefined
      ? null
      : tryCatchSync(() => globalThis.sessionStorage.getItem('token'))[1];
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }
  if (!headers.has('Content-Type') && init.body && typeof init.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }

  const csrfHeaderName = getCsrfConfig().headerName;
  const send = async (csrfToken: string | null): Promise<Response> => {
    const finalHeaders = new Headers(headers);
    if (csrfToken && STATE_CHANGING.has(method) && !finalHeaders.has(csrfHeaderName)) {
      finalHeaders.set(csrfHeaderName, csrfToken);
    }
    return fetch(input, {
      ...init,
      method,
      headers: finalHeaders,
      credentials: init.credentials ?? 'include',
    });
  };

  if (!STATE_CHANGING.has(method) || config.session.basedToken) {
    return send(null);
  }

  const requestOrigin = resolveRequestOrigin(input);
  const token = await getCsrfToken(requestOrigin);
  let response = await send(token);

  //? On csrfMismatch, the cached token is stale (session rotated). Clear and
  //? retry ONCE with a fresh fetch — covers the case where the user logged
  //? back in while a tab was idle. The retry is intentionally limited to one
  //? attempt: a second csrfMismatch means the session is broken in a way a
  //? fresh token won't fix (e.g. session expired), and retrying would loop.
  if (await isCsrfMismatchResponse(response)) {
    clearCsrfToken();
    const refreshed = await getCsrfToken(requestOrigin);
    if (refreshed) {
      response = await send(refreshed);
    }
  }

  return response;
};
