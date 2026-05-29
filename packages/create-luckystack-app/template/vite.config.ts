import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react-swc';
import tsconfigPaths from 'vite-tsconfig-paths';

//? Backend proxy targets are derived from `SERVER_IP` + `SERVER_PORT` in the
//? consumer's `.env` so a non-default port doesn't need a parallel edit here.
//? `loadEnv` reads `.env`, `.env.local`, `.env.[mode]`, `.env.[mode].local`
//? in that order — same precedence the framework uses elsewhere. Ships with
//? Vite; no extra dep.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const ip = env.SERVER_IP || '127.0.0.1';
  const port = env.SERVER_PORT || '80';
  const httpTarget = `http://${ip}:${port}`;
  const wsTarget = `ws://${ip}:${port}`;

  return {
    plugins: [
      react(),
      tsconfigPaths({ projects: ['tsconfig.json'] }),
    ],
    server: {
      port: 5173,
      host: true,
      proxy: {
        // Forward API + sync + auth + uploads + framework dev endpoints
        // to the backend declared by SERVER_IP/SERVER_PORT.
        '/api': httpTarget,
        '/sync': httpTarget,
        '/auth': httpTarget,
        '/uploads': httpTarget,
        '/_health': httpTarget,
        '/livez': httpTarget,
        '/readyz': httpTarget,
        '/_docs': httpTarget,
        '/socket.io': { target: wsTarget, ws: true },
      },
    },
  };
});
