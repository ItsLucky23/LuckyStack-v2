import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { registerProjectConfig } from '@luckystack/core';
import { handleHttpRequest } from './httpHandler';

//? Regression: behind a Cloudflare tunnel, or after a Cloudflare Access or
//? OAuth login, the browser lands on the app with a Referer from a foreign
//? site. The origin gate answered 403 to that page load; a reload or a typed
//? URL (no Referer) worked. A foreign page load may now get the public SPA
//? shell and static files, while every session route stays origin-gated.
const APP_ORIGIN = 'https://app.example.com';
const FOREIGN_REFERER = 'https://team.cloudflareaccess.com/cdn-cgi/access/login';

let server: Server;
let baseUrl = '';

beforeAll(async () => {
  registerProjectConfig({ http: { cors: { allowedOrigins: [APP_ORIGIN] } } });
  server = createServer((req, res) => {
    void handleHttpRequest(req, res, {
      serveFile: async (_req, response) => {
        response.writeHead(200, { 'Content-Type': 'text/html' });
        response.end('<!doctype html><title>spa</title>');
      },
    });
  });
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => { server.close(() => { resolve(); }); });
  registerProjectConfig({});
});

const get = (path: string, headers: Record<string, string>) =>
  fetch(`${baseUrl}${path}`, { headers, redirect: 'manual' });

describe('origin gate — page load from a foreign site', () => {
  it('serves the SPA shell for a page load with a foreign Referer', async () => {
    const response = await get('/dashboard', { referer: FOREIGN_REFERER });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('spa');
    //? Nothing foreign is reflected into CORS.
    expect(response.headers.get('access-control-allow-origin')).toBe('');
  });

  it('serves a static asset for a foreign Referer', async () => {
    const response = await get('/assets/index-abc.js', { referer: FOREIGN_REFERER });
    expect(response.status).toBe(200);
  });

  it.each(['/api/system/session/v1', '/sync/x/y/v1', '/auth/api/credentials', '/auth/callback', '/uploads/a.png', '/api'])(
    'keeps %s forbidden for a foreign Referer',
    async (path) => {
      const response = await get(path, { referer: FOREIGN_REFERER });
      expect(response.status).toBe(403);
    },
  );

  it('keeps a foreign CORS read (Origin header) forbidden', async () => {
    const response = await get('/dashboard', { origin: 'https://evil.example', referer: 'https://evil.example/' });
    expect(response.status).toBe(403);
  });

  it('keeps a foreign POST forbidden', async () => {
    const response = await fetch(`${baseUrl}/dashboard`, { method: 'POST', headers: { referer: FOREIGN_REFERER } });
    expect(response.status).toBe(403);
  });

  //? Some identity providers send their own site as Referer on the redirect to
  //? the callback. The request must reach the login callback, which then
  //? rejects it because this browser has no `ls-oauth-state` cookie.
  it('lets the OAuth callback through for a foreign Referer; the state check still decides', async () => {
    const response = await get('/auth/callback/google?code=c&state=s', { referer: 'https://accounts.google.com/' });
    expect(response.status).toBe(401);
    expect(await response.text()).toBe('Login failed');
    expect(response.headers.get('access-control-allow-origin')).toBe('');
  });

  it('keeps the OAuth callback forbidden for a foreign Origin header or a POST', async () => {
    const withOrigin = await get('/auth/callback/google', { origin: 'https://evil.example' });
    expect(withOrigin.status).toBe(403);
    const post = await fetch(`${baseUrl}/auth/callback/google`, { method: 'POST', headers: { referer: 'https://evil.example/' } });
    expect(post.status).toBe(403);
  });

  it('still reflects an allowed origin', async () => {
    const response = await get('/dashboard', { referer: `${APP_ORIGIN}/login` });
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe(APP_ORIGIN);
  });
});
