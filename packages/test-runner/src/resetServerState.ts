import { getProjectConfig, TEST_RESET_ONLY_PARAM, tryCatch } from '@luckystack/core';
import type { TestResetTarget } from '@luckystack/core';

//? Calls the server's /_test/reset endpoint. Used between rate-limit test
//? endpoints to drain the shared IP-based limiter bucket so one endpoint's
//? N+1 assertion doesn't consume the next endpoint's window.
//?
//? /_test/reset is gated by `NODE_ENV in { 'development', 'test' }` on the
//? server side AND requires `TEST_RESET_TOKEN` to be set unconditionally
//? (no token = 403). For staging/preview deploys that enable it for CI,
//? set `TEST_RESET_TOKEN` on the server and pass the same value here.

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

export interface ResetServerStateInput {
  baseUrl: string;
  token?: string;
  requestTimeoutMs?: number;
  /**
   * Clear only these targets (`?only=`). Omit for the server's default reset,
   * which ALSO deletes every Redis session — including an authenticated sweep's
   * own. The runner itself always passes `['rateLimits']`.
   */
  only?: TestResetTarget[];
}

export const resetServerState = async ({ baseUrl, token, requestTimeoutMs, only }: ResetServerStateInput): Promise<boolean> => {
  const endpoint = `${baseUrl.replace(/\/$/, '')}${getProjectConfig().http.testResetEndpoint}`;
  const url = only && only.length > 0
    ? `${endpoint}?${new URLSearchParams({ [TEST_RESET_ONLY_PARAM]: only.join(',') }).toString()}`
    : endpoint;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['X-Test-Reset-Token'] = token;

  //? Bound the call so a server that accepts the connection but never responds
  //? returns `false` (the existing failure path) instead of wedging the sweep.
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => { controller.abort(); }, requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS);
  const [error, response] = await tryCatch(() => fetch(url, { method: 'POST', headers, signal: controller.signal }));
  clearTimeout(timeoutHandle);
  if (error || !response) return false;
  return response.ok;
};
