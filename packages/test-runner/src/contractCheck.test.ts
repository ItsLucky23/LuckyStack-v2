import { afterEach, describe, expect, it, vi } from 'vitest';

import { runContractCheck } from './contractCheck';
import { runContractTests } from './runContractTests';
import { runFuzzCheck } from './fuzzCheck';
import type { ProbeResponse, ProbeTransport } from './probeRequest';
import { walkEndpoints } from './walkEndpoints';

//? A transport that answers every probe with a fixed reply, so the checks'
//? classification is pinned without a server.
const replying = (reply: ProbeResponse): ProbeTransport & { sent: number } => {
  const transport = {
    name: 'http' as const,
    sent: 0,
    send: () => {
      transport.sent += 1;
      return Promise.resolve(reply);
    },
  };
  return transport;
};

const [endpoint] = walkEndpoints({ user: { getProfile: { v1: 'POST' } } });

const check = async (reply: ProbeResponse, allowServerError?: boolean) => {
  if (!endpoint) throw new Error('fixture endpoint missing');
  return runContractCheck({ endpoint, baseUrl: 'http://localhost:1', transport: replying(reply), allowServerError });
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('runContractCheck — routing and server errors (finding 057)', () => {
  it.each([
    ['api.notFound', 404],
    ['api.methodNotAllowed', 405],
    ['api.invalidName', 400],
    ['sync.notFound', 404],
  ])('fails on routing error %s', async (errorCode, httpStatus) => {
    const result = await check({ httpStatus, parsed: { status: 'error', errorCode } });
    expect(result.status).toBe('fail');
    expect(result.errorCode).toBe(errorCode);
  });

  it('fails on a shaped HTTP 500', async () => {
    const result = await check({ httpStatus: 500, parsed: { status: 'error', errorCode: 'api.internalServerError' } });
    expect(result.status).toBe('fail');
  });

  it('fails on an execution-failed code without an HTTP status (socket reply)', async () => {
    const result = await check({ parsed: { status: 'error', errorCode: 'sync.serverExecutionFailed' } });
    expect(result.status).toBe('fail');
  });

  it('passes a server error on a route listed as designed to fail', async () => {
    const result = await check({ httpStatus: 500, parsed: { status: 'error', errorCode: 'api.internalServerError' } }, true);
    expect(result.status).toBe('pass');
  });

  it('still fails a routing error on a route listed as designed to fail', async () => {
    const result = await check({ httpStatus: 404, parsed: { status: 'error', errorCode: 'api.notFound' } }, true);
    expect(result.status).toBe('fail');
  });

  it('keeps passing an ordinary shaped business error', async () => {
    const result = await check({ httpStatus: 400, parsed: { status: 'error', errorCode: 'user.notFound' } });
    expect(result.status).toBe('pass');
  });
});

describe('rate-limited probes are not passes (finding 112)', () => {
  it('contract: a limiter rejection is skipped, not passed', async () => {
    const result = await check({ httpStatus: 429, parsed: { status: 'error', errorCode: 'api.rateLimitExceeded' } });
    expect(result.status).toBe('skipped');
    expect(result.reason).toContain('rate-limited');
  });

  it('fuzz: a limiter rejection stops the route as skipped, not passed', async () => {
    if (!endpoint) throw new Error('fixture endpoint missing');
    const transport = replying({ httpStatus: 429, parsed: { status: 'error', errorCode: 'api.rateLimitExceeded' } });
    const result = await runFuzzCheck({ endpoint, baseUrl: 'http://localhost:1', transport });
    expect(result.status).toBe('skipped');
    expect(transport.sent).toBe(1);
  });

  it('contract layer: resets rate limits before each route when given a reset token', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const transport = replying({ httpStatus: 200, parsed: { status: 'success' } });

    await runContractTests({
      apiMethodMap: { a: { one: { v1: 'POST' } }, b: { two: { v1: 'POST' } } },
      baseUrl: 'http://localhost:1',
      apiTransport: transport,
      resetToken: 'reset-secret',
    });

    expect(transport.sent).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('only=rateLimits');
  });

  it('contract layer: lets expectServerError routes pass a shaped 500', async () => {
    const transport = replying({ httpStatus: 500, parsed: { status: 'error', errorCode: 'api.internalServerError' } });
    const summary = await runContractTests({
      apiMethodMap: { playground: { throwError: { v1: 'POST' } }, user: { save: { v1: 'POST' } } },
      baseUrl: 'http://localhost:1',
      apiTransport: transport,
      expectServerError: ['playground/throwError'],
    });
    expect(summary.passed).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.results.find((r) => r.status === 'fail')?.endpoint.page).toBe('user');
  });
});
