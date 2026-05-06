/* eslint-disable */
//? Server entry. Loads env, runs side-effect imports for the major
//? config registries, then hands off to `bootstrapLuckyStack` which
//? auto-imports the `luckystack/<package>/` overlay folder and calls
//? `createLuckyStackServer`.

import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env' });
loadEnv({ path: '.env.local', override: true });

//? Side-effect imports — these populate registries that everything below
//? reads from. Order matters: project config first, then deploy/services.
import '../config';
import '../deploy.config';
import '../services.config';

import { bootstrapLuckyStack } from '@luckystack/server';

(async () => {
  //? Minimal static-file fallbacks. Most apps will swap these out for
  //? Vite-built static handlers in production; the server just needs SOME
  //? handler if you serve any static asset alongside `/api` and `/sync`.
  const noopServeFile = (_req: any, res: any) => {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  };
  const noopServeFavicon = (res: any) => {
    res.writeHead(204);
    res.end();
  };

  const server = await bootstrapLuckyStack({
    serveFile: noopServeFile,
    serveFavicon: noopServeFavicon,
  });

  await server.listen();
})().catch((err) => {
  console.error('[server] failed to start:', err);
  process.exit(1);
});
