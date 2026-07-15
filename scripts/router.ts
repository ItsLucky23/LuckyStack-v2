/**
 * LuckyStack load-balancer entrypoint.
 *
 * Usage:
 *   npm run router
 *   ROUTER_PORT=4000 NODE_ENV=development npm run router
 *   ROUTER_PORT=4000 LUCKYSTACK_ENV=staging LUCKYSTACK_PRESET=fleet-preset npm run router
 *
 * Environment:
 *   - ROUTER_PORT         Port to listen on (default 4000).
 *   - LUCKYSTACK_ENV      Which `deploy.config.ts -> environments` key this
 *                         router represents. Falls back to NODE_ENV, then
 *                         'development'.
 *   - LUCKYSTACK_PRESET   Preset key that the locally-running backend bundle
 *                         contains (optional — bounds which services count as
 *                         "local"; others go straight to fallback env).
 */

//? Side-effect imports FIRST — `startRouter` reads the services + deploy
//? registries and nothing else in this process populates them, so without these
//? the router died on "services config has not been registered" on EVERY
//? runtime. Order mirrors server/server.ts: config, then deploy, then services.
//? These import via the same source paths the configs themselves use, so all of
//? it lands in one module instance (see config.ts on why those stay source
//? imports: the barrel would drag ioredis into the client bundle).
import '../config';
import '../deploy.config';
import '../services.config';

import { startRouter } from '../packages/router/src/startRouter';

const main = async (): Promise<void> => {
  const currentEnvKey =
    process.env.LUCKYSTACK_ENV
    ?? process.env.NODE_ENV
    ?? 'development';

  const localPresetKey = process.env.LUCKYSTACK_PRESET;

  //? Capture the running handle so SIGINT/SIGTERM can close the Redis
  //? health-store + pub/sub clients. Discarding it (as before) left those
  //? connections open on Ctrl-C / SIGTERM. Mirrors the graceful-shutdown
  //? guard in `@luckystack/router`'s own CLI.
  const running = await startRouter({
    currentEnvKey,
    localPresetKey: localPresetKey && localPresetKey.length > 0 ? localPresetKey : undefined,
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stdout.write(`\n[router] ${signal} received, shutting down...\n`);
    await running.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
};

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`[router] fatal: ${message}\n`);
  process.exit(1);
});
