import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

const fromRoot = (relativePath: string) => fileURLToPath(new URL(relativePath, import.meta.url));

const normalizeFilePath = (value: string) => value.replace(/\\/g, '/');

const isIgnoredDevWatchPath = (filePath: string): boolean => {
  const normalizedPath = normalizeFilePath(filePath);
  return (
    normalizedPath.includes('/_api/')
    || normalizedPath.includes('/_sync/')
    || normalizedPath.includes('/server/')
    || normalizedPath.includes('/_server/')
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
        // Only apply heavy external filtering during the production build
        external: isProduction ? (id) => {
          const ignored = [/\/_api\//, /\/_sync\//, /\/server\//, /\/_server\//];
          return ignored.some(pattern => pattern.test(id));
        } : [],
      },
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
        usePolling: true,
        ignored: isIgnoredDevWatchPath,
      },
    }
  }
})