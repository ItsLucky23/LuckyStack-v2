import http, { type Server as HttpServer } from 'node:http';
import { writeBootUuid, getProjectConfig } from '@luckystack/core';
import { handleHttpRequest } from './httpHandler';
import { loadSocket } from './loadSocket';
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
  const port = options.port ?? process.env.SERVER_PORT ?? 80;
  const ip = options.ip ?? process.env.SERVER_IP ?? '127.0.0.1';
  const enableDevTools = options.enableDevTools ?? process.env.NODE_ENV !== 'production';

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
  }

  //? Boot UUID must be written before /_health can answer truthfully. Router
  //? boot handshake consumes /_health to verify shared-Redis topology.
  await writeBootUuid();

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
          console.log(`Server is running on http://${ip}:${String(port)}/`);
        }
        callback?.();
        resolve(httpServer);
      });
    });

  return { httpServer, ioServer, listen };
};
