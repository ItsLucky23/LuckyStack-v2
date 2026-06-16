//? Single-source fetch probe used by every check layer (contract, auth,
//? csrf, rate-limit). Centralises the AbortController + timeout + tryCatch
//? pattern so it isn't copied into each check file.

import { tryCatch } from '@luckystack/core';
import type { HttpMethod } from './types';

export interface ProbeRequestInput {
  url: string;
  method: HttpMethod;
  baseUrl: string;
  body?: unknown;
  headers?: Record<string, string>;
  requestTimeoutMs: number;
}

export interface ProbeResponse {
  httpStatus: number;
  parsed: { status?: string; errorCode?: string } | null;
}

/**
 * Send a single timed fetch probe and parse the JSON envelope. Returns
 * `null` when the request itself fails (network error or abort).
 */
export const sendProbe = async (input: ProbeRequestInput): Promise<ProbeResponse | null> => {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => { controller.abort(); }, input.requestTimeoutMs);

  const [fetchError, response] = await tryCatch(() => fetch(input.url, {
    method: input.method,
    headers: {
      'Content-Type': 'application/json',
      //? Browsers attach Origin on state-changing requests; the server's origin
      //? policy fail-closes POST/PUT/DELETE without one.
      'Origin': new URL(input.baseUrl).origin,
      ...input.headers,
    },
    body: input.method === 'GET' ? undefined : JSON.stringify(input.body),
    signal: controller.signal,
  }));
  clearTimeout(timeoutHandle);

  if (fetchError || !response) return null;

  const [, parsed] = await tryCatch<{ status?: string; errorCode?: string } | null, undefined>(
    async () => await response.json() as { status?: string; errorCode?: string },
  );

  return { httpStatus: response.status, parsed: parsed ?? null };
};
