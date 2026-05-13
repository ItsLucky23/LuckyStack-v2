import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [
    react(),
    tsconfigPaths({ projects: ['tsconfig.json'] }),
  ],
  server: {
    port: 5173,
    host: true,
    proxy: {
      // Forward API + sync + auth + uploads + the framework's own dev endpoints
      // to the backend running on SERVER_PORT (default 80). Adjust `target`
      // if you bind the server to a non-default port.
      '/api': 'http://localhost:80',
      '/sync': 'http://localhost:80',
      '/auth': 'http://localhost:80',
      '/uploads': 'http://localhost:80',
      '/_health': 'http://localhost:80',
      '/livez': 'http://localhost:80',
      '/readyz': 'http://localhost:80',
      '/_docs': 'http://localhost:80',
      '/socket.io': { target: 'ws://localhost:80', ws: true },
    },
  },
});
