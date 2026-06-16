import { describe, expect, it, vi } from 'vitest';

import { serveFile } from './serveFile';

//? Minimal ServerResponse stand-in capturing the status code + body that
//? serveFile writes. Only the members serveFile touches are implemented.
const createMockResponse = () => {
  const headers: Record<string, unknown> = {};
  const body: { value: unknown } = { value: '' };
  const res = {
    statusCode: 0,
    headers,
    body,
    headersSent: false,
    writeHead: vi.fn((status: number, headers?: Record<string, unknown>) => {
      res.statusCode = status;
      if (headers) Object.assign(res.headers, headers);
      res.headersSent = true;
      return res;
    }),
    setHeader: vi.fn((key: string, value: unknown) => {
      res.headers[key] = value;
    }),
    end: vi.fn((chunk?: unknown) => {
      if (chunk !== undefined) res.body.value = chunk;
      return res;
    }),
  };
  return res;
};

describe('serveFile', () => {
  it('responds 400 Bad Request on a malformed percent-escape instead of throwing (N-1)', async () => {
    const res = createMockResponse();

    //? decodeURIComponent('/assets/%ZZ') throws URIError; the guard must turn
    //? that into a 400 rather than letting it bubble to an unhandled rejection.
    await expect(serveFile({ url: '/assets/%ZZ' }, res as never)).resolves.not.toThrow();

    expect(res.statusCode).toBe(400);
    expect(res.body.value).toBe('Bad Request');
  });

  it('does not 400 a well-formed URL (behavior preserved for valid input)', async () => {
    const res = createMockResponse();

    //? A valid but non-existent asset path decodes fine and proceeds through the
    //? normal pipeline — it must NOT be short-circuited as a 400.
    await serveFile({ url: '/assets/does-not-exist.css' }, res as never);

    expect(res.statusCode).not.toBe(400);
  });
});
