import { defineConfig, loadEnv, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react-swc';
import tsconfigPaths from 'vite-tsconfig-paths';
import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

//? The dev backend writes its ACTUALLY-bound port to
//? `node_modules/.luckystack/dev-server.json` (it may have auto-incremented off
//? a busy `SERVER_PORT`). Read it so the proxy targets the real port; fall back
//? to `SERVER_PORT` from `.env` when the file is absent (backend not up yet, or
//? a production build). Re-read per request via `bypass` (below) so a backend
//? that hops ports mid-session is followed live.
const readBackendPort = (fallback: string): string => {
  try {
    const raw = fs.readFileSync(
      path.join(process.cwd(), 'node_modules', '.luckystack', 'dev-server.json'),
      'utf8',
    );
    const info = JSON.parse(raw) as { port?: number };
    return info.port ? String(info.port) : fallback;
  } catch {
    return fallback;
  }
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const ip = env.SERVER_IP || '127.0.0.1';
  const envPort = env.SERVER_PORT || '80';
  const backendTarget = (): string => `http://${ip}:${readBackendPort(envPort)}`;

  //? Vite's proxy (node-http-proxy) has NO `router` option, but `bypass` runs per
  //? request with the live options object — set `target` there so every proxied
  //? request hits the CURRENT backend port. socket.io always does an HTTP polling
  //? handshake before upgrading; that handshake passes through here and mutates
  //? the shared options object, so the subsequent websocket upgrade (which reuses
  //? the same object) is carried to the right port too. Returning undefined lets
  //? the proxy continue as normal.
  const followBackend = (_req: IncomingMessage, _res: ServerResponse, options: ProxyOptions): undefined => {
    options.target = backendTarget();
    return undefined;
  };

  //? Fresh options object per route (spread) so each entry's `bypass` mutates its
  //? own `target` and routes never cross-contaminate.
  const entry = (extra: ProxyOptions = {}): ProxyOptions => ({
    target: backendTarget(),
    bypass: followBackend,
    ...extra,
  });

  return {
    plugins: [
      react(),
      tsconfigPaths({ projects: ['tsconfig.json'] }),
    ],
    resolve: {
      //? Client build only: `config.ts` is shared by client + server and pulls
      //? `registerProjectConfig` from the bare `@luckystack/core` server barrel,
      //? which statically imports Node `crypto` (randomBytes) and can't be
      //? bundled for the browser. The browser-safe `/client` entry exports the
      //? same `registerProjectConfig`, so redirect the bare specifier to it for
      //? Vite only — the Node server still imports the real barrel, so each
      //? runtime keeps a single, consistent project-config registry. Exact-match
      //? regex so `@luckystack/core/client` itself is left untouched.
      alias: [
        { find: /^@luckystack\/core$/, replacement: '@luckystack/core/client' },
      ],
    },
    server: {
      port: 5173,
      host: true,
      proxy: {
        // Forward API + sync + auth + uploads + framework dev endpoints to the
        // backend declared by SERVER_IP/SERVER_PORT (or its auto-incremented port
        // advertised in node_modules/.luckystack/dev-server.json).
        '/api': entry(),
        '/sync': entry(),
        '/auth': entry(),
        '/uploads': entry(),
        '/_health': entry(),
        '/livez': entry(),
        '/readyz': entry(),
        '/_docs': entry(),
        '/socket.io': entry({ ws: true }),
      },
    },
  };
});
