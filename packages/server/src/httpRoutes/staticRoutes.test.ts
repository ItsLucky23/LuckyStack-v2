import { describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleStaticAndSpaFallback } from './staticRoutes';
import type { HttpRouteContext } from './types';

const run = async (url: string, routePath: string) => {
  const seenUrls: (string | undefined)[] = [];
  const req = { url } as IncomingMessage;
  const res = { writeHead: vi.fn(), end: vi.fn() } as unknown as ServerResponse;
  const serveFile = vi.fn((r: IncomingMessage) => { seenUrls.push(r.url); return Promise.resolve(); });
  const ctx = {
    req,
    res,
    routePath,
    options: { serveFile },
  } as unknown as HttpRouteContext;
  await handleStaticAndSpaFallback(ctx);
  return { seenUrls, req };
};

describe('handleStaticAndSpaFallback — known-extension files (finding 116)', () => {
  it('hands serveFile the query-less path for a top-level file with ?v=', async () => {
    const { seenUrls, req } = await run('/google.png?v=2', '/google.png');
    expect(seenUrls).toEqual(['/google.png']);
    //? The original URL is restored for anything downstream.
    expect(req.url).toBe('/google.png?v=2');
  });

  it('keeps the plain path unchanged', async () => {
    const { seenUrls } = await run('/google.png', '/google.png');
    expect(seenUrls).toEqual(['/google.png']);
  });
});
