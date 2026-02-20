import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import path from 'path';
// import tsconfigPaths from 'vite-tsconfig-paths'

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

// https://vite.dev/config/
// export default defineConfig({
//   base: '/',
//   plugins: [
//     react(),
//     // tsconfigPaths()
//   ],
//   build: {
//     rollupOptions: {
//       external: (id) => { // this is just for the server side to tell these files will be available at runtime, to ignore files in build process go to tsconfig.app.json
//         // Ignore route/server-only source folders
//         if (/\/_api\//.test(id)) return true;
//         if (/\/_sync\//.test(id)) return true;
//         if (/\/server\//.test(id)) return true;
//         if (/\/_server\//.test(id)) return true;

//         // Ignore standalone server-suffixed files
//         if (/_server\.(ts|tsx|js|jsx)$/.test(id)) return true;

//         return false;
//       },
//     },
//     target: 'esnext', // This makes sure the server redirects all 404s to index.html
//   },
//   resolve: {
//     alias: {
//       'src': path.resolve(__dirname, './src'),
//       'config': path.resolve(__dirname, './config'),
//     },
//   },
//   server: {
//     watch: {
//       usePolling: true,
//       ignored: [
//         '**/_api/**',
//         '**/_sync/**',
//         '**/server/**',
//         '**/_server/**',
//         '**/*_server.ts',
//         '**/*_server.tsx',
//       ]
//     },
//   }
// })
export default defineConfig(({ command }) => {
  const isProduction = command === 'build';

  return {
    base: '/',
    plugins: [react()],
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
      alias: {
        'src': path.resolve(__dirname, './src'),
        'shared': path.resolve(__dirname, './shared'),
        'config': path.resolve(__dirname, './config'),
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