import http, { type Server as HttpServer } from 'node:http';
import { registerBindAddress, writeBootUuid, getLogger, getProjectConfig, tryCatch } from '@luckystack/core';
import { handleHttpRequest } from './httpHandler';
import { loadSocket } from './loadSocket';
import { verifyBootstrap } from './verifyBootstrap';
import { registerProdRuntimeMapsProvider } from './runtimeMapsLoader';
import { getParsedPort } from './argv';
import type {
  CreateLuckyStackServerOptions,
  RunningLuckyStackServer,
} from './types';

/**
 * One-call server bootstrap for a LuckyStack project.
 *
 * Wires together:
 * - HTTP server with framework routes (`/api/*`, `/sync/*`, `/_health`,
 *   `/_test/reset`, `/uploads/*`, `/auth/api`, `/auth/callback`)
 * - Socket.io server with the Redis adapter, room handlers, presence
 *   integration, location sync
 * - Boot-UUID write so the router's handshake can verify topology
 * - Optional dev-mode tooling (devkit hot reload + REPL)
 *
 * Project responsibilities (passed in as options):
 * - `serveFile` / `serveFavicon` — your project's static file handlers
 * - `customRoutes` — any additional HTTP routes your app needs
 *
 * Pre-conditions:
 * - `registerProjectConfig(...)` must have run (side-effect import of your
 *   `config.ts` does this).
 * - `registerDeployConfig(...)` must have run (side-effect import of your
 *   `deploy.config.ts`).
 * - `registerRuntimeMapsProvider(...)` must have run (side-effect import of
 *   your `server/prod/runtimeMaps.ts`).
 * - `registerLocalizedNormalizer(...)` must have run (side-effect import of
 *   your `server/utils/responseNormalizer.ts`).
 *
 * @example
 * ```ts
 * import './config';
 * import './deploy.config';
 * import './prod/runtimeMaps';
 * import './utils/responseNormalizer';
 * import { createLuckyStackServer } from '@luckystack/server';
 * import { serveFile, serveFavicon } from './prod/serveFile';
 *
 * const server = await createLuckyStackServer({ serveFile, serveFavicon });
 * await server.listen();
 * ```
 */
export const createLuckyStackServer = async (
  options: CreateLuckyStackServerOptions = {}
): Promise<RunningLuckyStackServer> => {
  //? Auto-register the framework-shipped runtime maps provider when the
  //? consumer supplied a `loadGeneratedMaps` callback. Runs before
  //? `verifyBootstrap` so the registration counts toward the boot check.
  //? Consumers who hand-rolled their own provider via
  //? `registerRuntimeMapsProvider` can simply omit `loadGeneratedMaps` and
  //? the framework leaves their registration alone.
  if (options.loadGeneratedMaps) {
    registerProdRuntimeMapsProvider({
      loadGenerated: options.loadGeneratedMaps,
      preset: options.runtimeMapsPreset,
    });
  }

  //? Fail fast if a project's overlay forgot to register a critical piece.
  //? Surface a single readable error instead of a stack trace deep inside
  //? a request handler.
  await verifyBootstrap({
    requireDeployConfig: options.requireDeployConfig,
    requireServicesConfig: options.requireServicesConfig,
    requireOAuthProviders: options.requireOAuthProviders,
  });

  const port = options.port ?? getParsedPort() ?? process.env.SERVER_PORT ?? 80;
  const ip = options.ip ?? process.env.SERVER_IP ?? '127.0.0.1';
  const enableDevTools = options.enableDevTools ?? process.env.NODE_ENV !== 'production';

  //? Register the resolved bind address so framework code that needs it
  //? (e.g. `checkOrigin` building the same-origin entry) doesn't drift when
  //? the consumer passed `options.ip`/`options.port` without also setting
  //? the legacy `SERVER_IP`/`SERVER_PORT` env vars.
  registerBindAddress({
    ip,
    port: typeof port === 'string' ? Number.parseInt(port, 10) : port,
  });

  if (enableDevTools) {
    //? Dev-only: console-log color tagger + devkit hot reload + REPL.
    //? Kept dynamic so tier-A consumers in production never load the
    //? typescript compiler API or chokidar's filesystem watchers.
    const { initConsolelog } = await import('@luckystack/core');
    initConsolelog();
    const devkitModuleId = '@luckystack/devkit';
    const devkit = (await import(devkitModuleId)) as {
      initializeAll: () => Promise<void>;
      setupWatchers: () => void;
    };
    await devkit.initializeAll();
    devkit.setupWatchers();
    //? Belt-and-braces: explicit SIGINT/SIGTERM handler so Ctrl+C is honored
    //? even if a sync CPU burst (TS Program build, large require chain) is
    //? still in flight when the signal arrives.
    process.once('SIGINT', () => process.exit(0));
    process.once('SIGTERM', () => process.exit(0));
  }

  //? Boot UUID must be written before /_health can answer truthfully. Router
  //? boot handshake consumes /_health to verify shared-Redis topology. A
  //? failure here is almost always Redis being unreachable or misconfigured
  //? (bad credentials, wrong host); throw a clear, actionable error so boot
  //? halts on THIS message instead of the raw ioredis `ReplyError` dump that
  //? confused operators before. Library code must not `process.exit()`; the
  //? throw propagates to the boot entry and the dev supervisor respawns.
  //? `tryCatch` already captured the underlying error to the error tracker.
  const [bootUuidError] = await tryCatch(() => writeBootUuid());
  if (bootUuidError) {
    throw new Error(
      'Failed to write the boot UUID to Redis. Check REDIS_HOST / REDIS_PORT / REDIS_USERNAME / REDIS_PASSWORD and that Redis is reachable.',
      { cause: bootUuidError },
    );
  }

  const httpServer: HttpServer = http.createServer((req, res) => {
    void handleHttpRequest(req, res, options);
  });

  const ioServer = loadSocket(httpServer, {
    maxHttpBufferSize: options.maxHttpBufferSize,
  });

  const listen = (callback?: () => void): Promise<HttpServer> =>
    new Promise<HttpServer>((resolve) => {
      const portValue = typeof port === 'string' ? Number.parseInt(port, 10) : port;
      httpServer.listen(portValue, ip, () => {
        const config = getProjectConfig();
        if (config.logging.socketStartup || config.logging.devLogs) {
          getLogger().info(`Server is running on http://${ip}:${String(port)}/`);
        }
        callback?.();
        resolve(httpServer);
      });
    });

  return { httpServer, ioServer, listen };
};
