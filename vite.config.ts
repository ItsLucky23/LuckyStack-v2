import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
//? Under rolldown-vite (Vite 8) the oxc-based `@vitejs/plugin-react` is faster
//? than `@vitejs/plugin-react-swc` when no SWC plugins are used, and silences
//? the "switch to @vitejs/plugin-react" startup hint. See https://vite.dev/rolldown.
import react from '@vitejs/plugin-react'

const fromRoot = (relativePath: string) => fileURLToPath(new URL(relativePath, import.meta.url));

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
    }
  }
})