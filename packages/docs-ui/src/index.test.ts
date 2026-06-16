import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';

//? `mountDocsUi` reads two cross-package symbols from @luckystack/core:
//? `getGeneratedApiDocsPath` (the default JSON file path) and `tryCatch`
//? (the [error, result] tuple wrapper used around the fs read). We mock the
//? whole module so no real config/registry is touched. `tryCatch` is given a
//? faithful implementation (awaits the thunk, returns [null, value] on
//? success / [error, null] on throw) so the JSON-route success and failure
//? branches are exercised exactly as in production.
const getGeneratedApiDocsPathMock = vi.fn<() => string>();

vi.mock('@luckystack/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@luckystack/core')>()),
  getGeneratedApiDocsPath: () => getGeneratedApiDocsPathMock(),
  tryCatch: async <T>(fn: () => Promise<T> | T): Promise<[Error | null, T | null]> => {
    try {
      return [null, await fn()];
    } catch (error) {
      return [error as Error, null];
    }
  },
}));

//? The handler reads from `node:fs/promises`. We mock `readFile` so the JSON
//? sub-route can be driven to both the "file present" and "file missing"
//? branches without touching the filesystem.
const readFileMock = vi.fn<(path: string, encoding: string) => Promise<string>>();

vi.mock('node:fs/promises', () => ({
  default: {
    readFile: (path: string, encoding: string) => readFileMock(path, encoding),
  },
}));

import { mountDocsUi } from './index';

//? Minimal ServerResponse double. We only capture what the handler writes:
//? statusCode, headers, and the body passed to `end`.
interface FakeRes {
  statusCode: number;
  headers: Record<string, string>;
  body: string | null;
  setHeader: (name: string, value: string) => void;
  end: (chunk?: string) => void;
}

const makeRes = (): FakeRes => {
  const res: FakeRes = {
    statusCode: 0,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    end(chunk) {
      this.body = chunk ?? null;
    },
  };
  return res;
};

const makeReq = (url: string | undefined, method = 'GET'): IncomingMessage =>
  ({ url, method }) as unknown as IncomingMessage;

//? Cast the fake response to the structural ServerResponse the handler needs.
//? The handler only calls setHeader/end and assigns statusCode, all present.
const asRes = (res: FakeRes): ServerResponse => res as unknown as ServerResponse;

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

describe('mountDocsUi', () => {
  beforeEach(() => {
    getGeneratedApiDocsPathMock.mockReset();
    readFileMock.mockReset();
    getGeneratedApiDocsPathMock.mockReturnValue('/resolved/apiDocs.generated.json');
    //? Default to a non-production env; the prod-gate test overrides this.
    process.env.NODE_ENV = 'development';
  });

  //? Restore NODE_ENV after each test so the prod-gating cases never leak
  //? into sibling tests in the same worker.
  afterEach(() => {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  });

  describe('route matching', () => {
    it('returns false for a path that matches neither the docs route nor its JSON sub-route', async () => {
      const handler = mountDocsUi();
      const res = makeRes();
      const handled = await handler(makeReq('/some/other/path'), asRes(res));
      expect(handled).toBe(false);
      //? A non-match must not write any response.
      expect(res.statusCode).toBe(0);
      expect(res.body).toBeNull();
    });

    it('matches the default docs route and serves HTML', async () => {
      const handler = mountDocsUi();
      const res = makeRes();
      const handled = await handler(makeReq('/_docs'), asRes(res));
      expect(handled).toBe(true);
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body).toContain('<!DOCTYPE html>');
    });

    it('honors a custom routePath for both the page and JSON sub-route', async () => {
      const handler = mountDocsUi({ routePath: '/internal/docs' });
      const pageRes = makeRes();
      const pageHandled = await handler(makeReq('/internal/docs'), asRes(pageRes));
      expect(pageHandled).toBe(true);
      expect(pageRes.headers['content-type']).toBe('text/html; charset=utf-8');

      readFileMock.mockResolvedValue('{"apis":{}}');
      const jsonRes = makeRes();
      const jsonHandled = await handler(makeReq('/internal/docs/api.json'), asRes(jsonRes));
      expect(jsonHandled).toBe(true);
      expect(jsonRes.headers['content-type']).toBe('application/json; charset=utf-8');

      //? The default route must no longer match once overridden.
      const missRes = makeRes();
      expect(await handler(makeReq('/_docs'), asRes(missRes))).toBe(false);
    });

    it('matches the route even when a query string is appended', async () => {
      const handler = mountDocsUi();
      const res = makeRes();
      const handled = await handler(makeReq('/_docs?foo=bar'), asRes(res));
      expect(handled).toBe(true);
      expect(res.statusCode).toBe(200);
    });

    it('treats a missing req.url as a non-matching path', async () => {
      const handler = mountDocsUi();
      const res = makeRes();
      const handled = await handler(makeReq(undefined), asRes(res));
      expect(handled).toBe(false);
    });
  });

  describe('HTML page rendering', () => {
    it('uses the default page title when none is provided', async () => {
      const handler = mountDocsUi();
      const res = makeRes();
      await handler(makeReq('/_docs'), asRes(res));
      expect(res.body).toContain('<title>LuckyStack — API docs</title>');
    });

    it('uses a custom page title and points the page at the JSON sub-route', async () => {
      const handler = mountDocsUi({ pageTitle: 'Acme Docs', routePath: '/_docs' });
      const res = makeRes();
      await handler(makeReq('/_docs'), asRes(res));
      expect(res.body).toContain('<title>Acme Docs</title>');
      //? The embedded fetch target is the route's JSON sub-path.
      expect(res.body).toContain('const JSON_PATH = "/_docs/api.json";');
    });

    it('passes branding and enableTryItOut through to the default renderer', async () => {
      const handler = mountDocsUi({
        branding: { brandColor: '#abcdef' },
        enableTryItOut: true,
      });
      const res = makeRes();
      await handler(makeReq('/_docs'), asRes(res));
      expect(res.body).toContain('--accent: #abcdef;');
      expect(res.body).toContain('const ENABLE_TRY_IT_OUT = true;');
    });

    it('delegates to a custom template builder and bypasses the default renderer', async () => {
      const template = vi.fn(
        ({ jsonPath, pageTitle }: { jsonPath: string; pageTitle: string }) =>
          `<custom>${pageTitle} @ ${jsonPath}</custom>`,
      );
      const handler = mountDocsUi({ template, pageTitle: 'Branded', routePath: '/docs' });
      const res = makeRes();
      await handler(makeReq('/docs'), asRes(res));
      expect(template).toHaveBeenCalledOnce();
      expect(template).toHaveBeenCalledWith({
        jsonPath: '/docs/api.json',
        pageTitle: 'Branded',
        branding: {},
      });
      expect(res.body).toBe('<custom>Branded @ /docs/api.json</custom>');
      //? The default renderer's doctype must be absent when a template wins.
      expect(res.body).not.toContain('<!DOCTYPE html>');
    });
  });

  describe('JSON sub-route', () => {
    it('serves the file contents with a no-store cache header on success', async () => {
      readFileMock.mockResolvedValue('{"apis":{"page":{}}}');
      const handler = mountDocsUi();
      const res = makeRes();
      const handled = await handler(makeReq('/_docs/api.json'), asRes(res));
      expect(handled).toBe(true);
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body).toBe('{"apis":{"page":{}}}');
    });

    it('reads from getGeneratedApiDocsPath() by default', async () => {
      readFileMock.mockResolvedValue('{}');
      const handler = mountDocsUi();
      await handler(makeReq('/_docs/api.json'), asRes(makeRes()));
      expect(getGeneratedApiDocsPathMock).toHaveBeenCalledOnce();
      expect(readFileMock).toHaveBeenCalledWith('/resolved/apiDocs.generated.json', 'utf8');
    });

    it('reads from an explicit apiDocsPath override instead of the resolver', async () => {
      readFileMock.mockResolvedValue('{}');
      const handler = mountDocsUi({ apiDocsPath: '/custom/docs.json' });
      await handler(makeReq('/_docs/api.json'), asRes(makeRes()));
      expect(getGeneratedApiDocsPathMock).not.toHaveBeenCalled();
      expect(readFileMock).toHaveBeenCalledWith('/custom/docs.json', 'utf8');
    });

    it('returns a 404 JSON payload with a hint when the file cannot be read', async () => {
      readFileMock.mockRejectedValue(new Error('ENOENT'));
      const handler = mountDocsUi({ apiDocsPath: '/missing/docs.json' });
      const res = makeRes();
      const handled = await handler(makeReq('/_docs/api.json'), asRes(res));
      expect(handled).toBe(true);
      expect(res.statusCode).toBe(404);
      expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
      const payload = JSON.parse(res.body ?? '{}');
      expect(payload.error).toBe('apiDocs.generated.json not found');
      expect(payload.expectedAt).toBe('/missing/docs.json');
      expect(payload.hint).toContain('generateArtifacts');
    });
  });

  describe('HTTP method enforcement', () => {
    it('returns 405 for a non-GET request to the docs route', async () => {
      const handler = mountDocsUi();
      const res = makeRes();
      const handled = await handler(makeReq('/_docs', 'POST'), asRes(res));
      expect(handled).toBe(true);
      expect(res.statusCode).toBe(405);
      expect(res.body).toBe('Method Not Allowed');
      //? A 405 must not attempt to read the docs JSON.
      expect(readFileMock).not.toHaveBeenCalled();
    });

    it('returns 405 for a non-GET request to the JSON sub-route', async () => {
      const handler = mountDocsUi();
      const res = makeRes();
      const handled = await handler(makeReq('/_docs/api.json', 'PUT'), asRes(res));
      expect(handled).toBe(true);
      expect(res.statusCode).toBe(405);
      expect(readFileMock).not.toHaveBeenCalled();
    });
  });

  describe('production gating', () => {
    it('returns a 404 in production when enabledInProd is not set', async () => {
      process.env.NODE_ENV = 'production';
      const handler = mountDocsUi();
      const res = makeRes();
      const handled = await handler(makeReq('/_docs'), asRes(res));
      expect(handled).toBe(true);
      expect(res.statusCode).toBe(404);
      expect(res.headers['content-type']).toBe('text/plain');
      expect(res.body).toBe('Not Found');
    });

    it('still serves HTML in production when enabledInProd is true', async () => {
      process.env.NODE_ENV = 'production';
      const handler = mountDocsUi({ enabledInProd: true });
      const res = makeRes();
      const handled = await handler(makeReq('/_docs'), asRes(res));
      expect(handled).toBe(true);
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('<!DOCTYPE html>');
    });

    it('still falls through (returns false) for a non-matching path in production', async () => {
      process.env.NODE_ENV = 'production';
      const handler = mountDocsUi();
      const res = makeRes();
      //? The prod 404 only applies to matched routes; non-matches still pass.
      const handled = await handler(makeReq('/elsewhere'), asRes(res));
      expect(handled).toBe(false);
      expect(res.statusCode).toBe(0);
    });
  });
});
