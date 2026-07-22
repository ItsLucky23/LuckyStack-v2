import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react-swc';
import tsconfigPaths from 'vite-tsconfig-paths';
import fs from 'node:fs';
import path from 'node:path';
import { ports } from './config.ports';
import { createDynamicProxyOptions, isProcessRunning, type DynamicProxyOptions } from './viteBackendProxy';

//? The dev backend writes its ACTUALLY-bound port to
//? `node_modules/.luckystack/dev-server.json` (it may have auto-incremented off
//? a busy port). Read it so the proxy targets the real port; fall back to the
//? `config.ports.ts` backend port when the file is absent (backend not up yet, or
//? a production build). Re-read per request via `bypass` (below) so a backend
//? that hops ports mid-session is followed live.
const readBackendPort = (fallback: string): string => {
  try {
    const raw = fs.readFileSync(
      path.join(process.cwd(), 'node_modules', '.luckystack', 'dev-server.json'),
      'utf8',
    );
    const info = JSON.parse(raw) as { port?: unknown; pid?: unknown };
    return typeof info.port === 'number'
      && Number.isInteger(info.port)
      && info.port > 0
      && info.port <= 65_535
      && isProcessRunning(info.pid)
      ? String(info.port)
      : fallback;
  } catch {
    return fallback;
  }
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const ip = env.SERVER_IP || '127.0.0.1';
  //? Proxy target resolution (config-driven, single source = config.ports.ts):
  //?   1. ports.devBackendUrl — develop against a REMOTE backend (deployed/staging).
  //?      The browser stays same-origin (localhost), the proxy makes the cross-origin
  //?      hop with changeOrigin, so cookies stay first-party + no CORS needed.
  //?   2. ROUTER_PORT (env) — cluster-dev: proxy the @luckystack/router, which fans
  //?      out per service-key (deploy.config.ts bindings).
  //?   3. the local backend on ports.backend (following an auto-incremented port via
  //?      node_modules/.luckystack/dev-server.json). SERVER_PORT is no longer read.
  const remoteBackend = ports.devBackendUrl?.trim() || undefined;
  const routerPort = env.ROUTER_PORT && /^\d+$/.test(env.ROUTER_PORT) ? env.ROUTER_PORT : undefined;
  const backendTarget = (): string =>
    remoteBackend
      ? remoteBackend
      : routerPort
        ? `http://${ip}:${routerPort}`
        : `http://${ip}:${readBackendPort(String(ports.backend))}`;

  //? Fresh options object per route so HTTP requests and direct WebSocket
  //? upgrades both resolve the CURRENT backend port. The helper updates Vite's
  //? request clone AND the original options object held by node-http-proxy.
  const entry = (extra: DynamicProxyOptions = {}) => createDynamicProxyOptions(
    backendTarget,
    {
      //? A remote backend (ports.devBackendUrl) sits on a different host, so rewrite
      //? the Host header to match it (vhost routing + TLS SNI); the local/router
      //? target is same-host so it stays off.
      changeOrigin: Boolean(remoteBackend),
      ...extra,
    },
  );

  return {
    plugins: [
      react(),
      tsconfigPaths({ projects: ['tsconfig.json'] }),
    ],
    server: {
      port: ports.frontend,
      host: true,
      proxy: {
        // Forward API + sync + auth + uploads + framework dev endpoints to the
        // backend on SERVER_IP + config.ports.ts `backend` (or its auto-incremented
        // port advertised in node_modules/.luckystack/dev-server.json), or to the
        // router when ROUTER_PORT is set (cluster-dev).
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
