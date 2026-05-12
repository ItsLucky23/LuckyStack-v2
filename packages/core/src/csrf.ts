//? Client-side CSRF helper. Lazily fetches and caches the session's CSRF
//? token from `/auth/csrf`, then attaches it as `x-csrf-token` on
//? subsequent HTTP fetches in cookie mode.
//?
//? Token-mode sessions are CSRF-immune because cross-origin POSTs do not
//? auto-attach the sessionStorage value; the cache simply stays empty in
//? that mode.

import { getProjectConfig } from './projectConfig';
import tryCatch from './tryCatch';

let cachedToken: string | null = null;
let inflightFetch: Promise<string | null> | null = null;

const resolveBackendUrl = (): string => {
  // The browser's location is the most reliable backend URL when the app
  // is served same-origin. Server-side callers should not invoke this
  // helper — they have direct access to the session.
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return '';
};

const fetchCsrfToken = async (): Promise<string | null> => {
  const base = resolveBackendUrl();
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
export const getCsrfToken = async (): Promise<string | null> => {
  //? Token-mode sessions: skip entirely. The server doesn't enforce CSRF
  //? in token mode, and there's no value to attach.
  if (getProjectConfig().session.basedToken) {
    return null;
  }

  if (cachedToken) return cachedToken;
  if (inflightFetch) return inflightFetch;

  inflightFetch = fetchCsrfToken().then((token) => {
    cachedToken = token;
    inflightFetch = null;
    return token;
  });

  return inflightFetch;
};

/** Drop the cached token. Call this on logout or when a 403 csrfMismatch is seen. */
export const clearCsrfToken = (): void => {
  cachedToken = null;
  inflightFetch = null;
};

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const isCsrfMismatchResponse = async (response: Response): Promise<boolean> => {
  if (response.status !== 403) return false;
  const [error, isMismatch] = await tryCatch<boolean, undefined>(async () => {
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
  if (!headers.has('Content-Type') && init.body && typeof init.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }

  const send = async (csrfToken: string | null): Promise<Response> => {
    const finalHeaders = new Headers(headers);
    if (csrfToken && STATE_CHANGING.has(method) && !finalHeaders.has('x-csrf-token')) {
      finalHeaders.set('x-csrf-token', csrfToken);
    }
    return fetch(input, {
      ...init,
      method,
      headers: finalHeaders,
      credentials: init.credentials ?? 'include',
    });
  };

  if (!STATE_CHANGING.has(method) || getProjectConfig().session.basedToken) {
    return send(null);
  }

  const token = await getCsrfToken();
  let response = await send(token);

  //? On csrfMismatch, the cached token is stale (session rotated). Clear and
  //? retry once with a fresh fetch — covers the case where the user logged
  //? back in while a tab was idle.
  if (await isCsrfMismatchResponse(response)) {
    clearCsrfToken();
    const refreshed = await getCsrfToken();
    if (refreshed) {
      response = await send(refreshed);
    }
  }

  return response;
};
