import type { ContractCheckResult, EndpointDescriptor } from './types';

const REQUEST_TIMEOUT_MS = 5000;

//? Lightweight fuzz layer — no Zod yet. Sends well-known junk shapes and
//? asserts the server doesn't 5xx or return a non-envelope body. Real
//? schema-driven fuzzing (TS type -> random valid input) is deferred until
//? the generator emits Zod schemas alongside the types.
const JUNK_PAYLOADS: unknown[] = [
  null,
  [],
  [1, 2, 3],
  'string-instead-of-object',
  1234567890,
  true,
  { nested: { deeply: { nested: { value: 'x'.repeat(10000) } } } },
  { __proto__: { polluted: true } },
  { key: null, other: undefined, third: Number.NaN },
];

export interface FuzzCheckInput {
  endpoint: EndpointDescriptor;
  baseUrl: string;
  headers?: Record<string, string>;
}

const probe = async (
  endpoint: EndpointDescriptor,
  baseUrl: string,
  body: unknown,
  headers?: Record<string, string>,
): Promise<{ httpStatus: number; parsed: { status?: unknown; errorCode?: unknown } | null } | null> => {
  const url = `${baseUrl.replace(/\/$/, '')}/${endpoint.fullPath}`;
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: endpoint.method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: endpoint.method === 'GET' ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const parsed = await response.json().catch(() => null) as { status?: unknown; errorCode?: unknown } | null;
    return { httpStatus: response.status, parsed };
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutHandle);
  }
};

export const runFuzzCheck = async (input: FuzzCheckInput): Promise<ContractCheckResult> => {
  const started = Date.now();

  for (const payload of JUNK_PAYLOADS) {
    const result = await probe(input.endpoint, input.baseUrl, payload, input.headers);
    const durationMs = Date.now() - started;

    if (!result) {
      return {
        endpoint: input.endpoint,
        status: 'fail',
        reason: `fuzz probe crashed (no response) with payload: ${JSON.stringify(payload).slice(0, 80)}`,
        durationMs,
      };
    }

    if (result.httpStatus >= 500) {
      return {
        endpoint: input.endpoint,
        status: 'fail',
        httpStatus: result.httpStatus,
        reason: `fuzz payload produced 5xx: ${JSON.stringify(payload).slice(0, 80)}`,
        durationMs,
      };
    }

    if (!result.parsed || (result.parsed.status !== 'success' && result.parsed.status !== 'error')) {
      return {
        endpoint: input.endpoint,
        status: 'fail',
        httpStatus: result.httpStatus,
        reason: `fuzz payload produced non-envelope response: ${JSON.stringify(payload).slice(0, 80)}`,
        durationMs,
      };
    }

    if (result.parsed.status === 'error' && typeof result.parsed.errorCode !== 'string') {
      return {
        endpoint: input.endpoint,
        status: 'fail',
        httpStatus: result.httpStatus,
        reason: `fuzz error response missing errorCode for payload: ${JSON.stringify(payload).slice(0, 80)}`,
        durationMs,
      };
    }
  }

  return {
    endpoint: input.endpoint,
    status: 'pass',
    durationMs: Date.now() - started,
  };
};
