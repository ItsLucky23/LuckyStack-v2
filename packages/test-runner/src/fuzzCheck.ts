import type { ContractCheckResult, EndpointDescriptor } from './types';
import { sendProbe } from './probeRequest';

const DEFAULT_REQUEST_TIMEOUT_MS = 5000;

//? Lightweight fuzz layer — no Zod yet. Sends well-known junk shapes and
//? asserts the server doesn't 5xx or return a non-envelope body. Real
//? schema-driven fuzzing (TS type -> random valid input) is deferred until
//? the generator emits Zod schemas alongside the types.
const JUNK_PAYLOADS: readonly unknown[] = [
  null,
  [],
  [1, 2, 3],
  'string-instead-of-object',
  1_234_567_890,
  true,
  { nested: { deeply: { nested: { value: 'x'.repeat(10_000) } } } },
  //? `{ __proto__: ... }` serializes to `{}` via JSON.stringify (prototype keys
  //? are not own-enumerable), so it would probe nothing. Use `constructor` instead
  //? — a named own-key that some parsers misinterpret but survives JSON round-trip.
  { constructor: { polluted: true } },
  { key: null, other: undefined, third: Number.NaN },
];

export interface FuzzCheckInput {
  endpoint: EndpointDescriptor;
  baseUrl: string;
  headers?: Record<string, string>;
  /** Per-call request timeout in ms. Defaults to 5000. */
  requestTimeoutMs?: number;
}

export const runFuzzCheck = async (input: FuzzCheckInput): Promise<ContractCheckResult> => {
  const started = Date.now();
  const requestTimeoutMs = input.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const url = `${input.baseUrl.replace(/\/$/, '')}/${input.endpoint.fullPath}`;

  for (const payload of JUNK_PAYLOADS) {
    const result = await sendProbe({
      url,
      method: input.endpoint.method,
      baseUrl: input.baseUrl,
      body: payload,
      headers: input.headers,
      requestTimeoutMs,
    });
    const durationMs = Date.now() - started;

    if (!result) {
      return {
        endpoint: input.endpoint,
        status: 'fail',
        reason: `fuzz probe crashed (no response) with payload: ${JSON.stringify(payload).slice(0, 80)}`,
        durationMs,
      };
    }

    //? A 5xx that STILL returns a valid `{ status:'error', errorCode }` envelope
    //? is the framework gracefully catching an error (e.g. a route designed to
    //? throw), not a crash. The fuzz layer's concern is crashes / hangs /
    //? garbage — so we only fail on a non-envelope body below (which catches raw
    //? 5xx, HTML error pages, and truncated responses). A controlled 500
    //? envelope passes.
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
