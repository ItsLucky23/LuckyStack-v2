import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { defineConfig, type ProxyOptions } from 'vite'
//? Under rolldown-vite (Vite 8) the oxc-based `@vitejs/plugin-react` is faster
//? than `@vitejs/plugin-react-swc` when no SWC plugins are used, and silences
//? the "switch to @vitejs/plugin-react" startup hint. See https://vite.dev/rolldown.
import react from '@vitejs/plugin-react'
//? Single source of truth for the backend port fallback (config.ports.ts).
import { ports } from './config.ports'

const fromRoot = (relativePath: string) => fileURLToPath(new URL(relativePath, import.meta.url));

//? The dev backend writes its ACTUALLY-bound port to
//? `node_modules/.luckystack/dev-server.json` (it may have auto-incremented off a
//? busy port). Read it so the proxy targets the real port; fall back to
//? `config.ports.ts` `backend` when the file is absent (backend not up yet, or a
//? production build). Re-read per request via the `bypass` hook so a backend that
//? hops mid-session is followed live. Mirrors the shipped template proxy.
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

const normalizeFilePath = (value: string) => value.replace(/\\/g, '/');

const isIgnoredDevWatchPath = (filePath: string): boolean => {
  const normalizedPath = normalizeFilePath(filePath);
  return (
    normalizedPath.includes('/_api/')
    || normalizedPath.includes('/_sync/')
    || normalizedPath.includes('/server/')
    || normalizedPath.includes('/_server/')
    //? Heavy artifact trees that the client bundle never imports — never watch
    //? them. `.smoke-test` is a full scaffolded project (612+ source files);
    //? polling them wastes CPU. `dist`/`.cache` are build output.
    || normalizedPath.includes('/.smoke-test/')
    || normalizedPath.includes('/dist/')
    || normalizedPath.includes('/.cache/')
    //? Regenerated wholesale by `build:packages` (copyFrameworkDocs) WHILE the
    //? dev server runs; chokidar's scandir then races the delete/recreate and
    //? the resulting FSWatcher error is UNHANDLED in Vite → the whole dev
    //? server process dies. Never watch generated publish artifacts.
    || normalizedPath.includes('/framework-docs/')
    || normalizedPath.endsWith('/src/_sockets/apiTypes.generated.ts')
    || normalizedPath.endsWith('/src/docs/apiDocs.generated.json')
  );
};

export default defineConfig(({ command }) => {
  const isProduction = command === 'build';

  //? Proxy target: a running local router (ROUTER_PORT, cluster-dev) wins, else
  //? the local backend on `config.ports.ts` `backend` — following an
  //? auto-incremented port advertised in dev-server.json.
  const ip = process.env.SERVER_IP || '127.0.0.1';
  const routerPort = process.env.ROUTER_PORT && /^\d+$/.test(process.env.ROUTER_PORT) ? process.env.ROUTER_PORT : undefined;
  const backendTarget = (): string =>
    routerPort
      ? `http://${ip}:${routerPort}`
      : `http://${ip}:${readBackendPort(String(ports.backend))}`;

  //? Vite's proxy has no live `router` option, but `bypass` runs per request with
  //? the shared options object — set `target` there so every proxied request hits
  //? the CURRENT backend port. socket.io's HTTP polling handshake passes through
  //? here first and mutates the object, carrying the WS upgrade to the right port.
  const followBackend = (_req: IncomingMessage, _res: ServerResponse, options: ProxyOptions): undefined => {
    options.target = backendTarget();
    return undefined;
  };
  const entry = (extra: ProxyOptions = {}): ProxyOptions => ({
    target: backendTarget(),
    bypass: followBackend,
    ...extra,
  });

  return {
    base: '/',
    cacheDir: '.cache/vite',
    plugins: [
      react(),
    ],
    build: {
      rollupOptions: {
        //? This monorepo sample intentionally compiles the full Tailwind corpus;
        //? vite:css therefore dominates every release build. Keep size/timing
        //? output, but disable Rolldown's repetitive non-actionable timing nudge.
        checks: { pluginTimings: false },
        // Only apply heavy external filtering during the production build
        external: isProduction ? (id) => {
          const ignored = [/\/_api\//, /\/_sync\//, /\/server\//, /\/_server\//];
          return ignored.some(pattern => pattern.test(id));
        } : [],
      },
      //? The Sentry-enabled app shell is ~680 kB minified (~216 kB gzip). Set an
      //? explicit reviewed budget above that measured baseline instead of using
      //? Vite's generic 500 kB warning threshold.
      chunkSizeWarningLimit: 750,
      target: 'esnext',
    },
    resolve: {
      tsconfigPaths: true,
      //? Framework-monorepo dev-only: force ONE source instance of each
      //? @luckystack client entry for EVERY importer (incl. packages/*/src).
      //? Vite's `tsconfigPaths` only applies the root tsconfig.client.json
      //? @luckystack→source paths to importers under src/; a file inside
      //? packages/<pkg>/src is governed by its own package tsconfig (no such
      //? paths), so its `@luckystack/core/client` falls through to node_modules
      //? → packages/core/dist/client.js — a SECOND copy of socketState /
      //? projectConfig / offlineQueue. That split hands syncRequest a different
      //? (forever-null) socket than setSocket writes, killing all sync. These
      //? aliases (applied globally, before any other resolution) collapse the
      //? @luckystack client entrypoints to a single source instance. Bare
      //? server barrels are intentionally NOT aliased — client runtime never
      //? imports them and doing so would pull node-only code into the bundle.
      alias: {
        '@luckystack/core/client': fromRoot('./packages/core/src/client.ts'),
        '@luckystack/sync/client': fromRoot('./packages/sync/src/client.ts'),
        '@luckystack/presence/client': fromRoot('./packages/presence/src/client/index.ts'),
      },
    },
    // Define a global constant so your main.tsx knows if it's building for prod
    define: {
      __IS_PROD__: isProduction,
    },
    server: {
      watch: {
        //? Polling is OFF by default — native fs events are far cheaper and work
        //? on local NTFS/macOS/Linux. Set `VITE_USE_POLLING=1` only when the
        //? source lives on a filesystem without reliable native events (WSL2 →
        //? Windows drive, Docker bind mounts, some network shares). Leaving it on
        //? everywhere pegs a CPU core (it re-stats every watched file on a timer).
        usePolling: process.env.VITE_USE_POLLING === '1',
        ignored: isIgnoredDevWatchPath,
      },
      //? Same-origin proxy so the browser (which now talks to `window.origin` by
      //? default — see config.ts `resolveBackendUrl`) reaches the backend on its
      //? REAL bound port, auto-increment hops included. Previously absent, so the
      //? root sample app talked directly to a frozen `localhost:80` and every
      //? socket/api/auth call hard-failed after a hop.
      proxy: {
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
    }
  }
})