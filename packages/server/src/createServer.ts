import http, { type Server as HttpServer } from 'node:http';
import { registerBindAddress, writeBootUuid, getLogger, getProjectConfig, tryCatch } from '@luckystack/core';
import { handleHttpRequest } from './httpHandler';
import { loadSocket } from './loadSocket';
import { verifyBootstrap } from './verifyBootstrap';
import { registerProdRuntimeMapsProvider } from './runtimeMapsLoader';
import { getParsedPort } from './argv';
import { runGracefulShutdown } from './stopServer';
import type {
  CreateLuckyStackServerOptions,
  RunningLuckyStackServer,
  StopLuckyStackServerOptions,
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
//? Extracted verbatim from the previous inline `if (enableDevTools) { ... }`
//? block. Same dynamic imports, same ordering, same SIGINT/SIGTERM handlers —
//? hoisted so the bootstrap function reads as a sequence of named steps.
const initDevTools = async (): Promise<void> => {
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
};

//? Extracted verbatim from the previous inline `listen` closure. Same
//? auto-increment opt-in, same EADDRINUSE retry, same truthful-failure
//? logging, same success log + callback + resolve. `httpServer`, `ip`, and
//? `port` are threaded in as parameters instead of closed over.
export const listenLuckyStackServer = (
  httpServer: HttpServer,
  ip: string,
  port: string | number,
  callback?: () => void,
): Promise<HttpServer> =>
  new Promise<HttpServer>((resolve, reject) => {
    const startPort = typeof port === 'string' ? Number.parseInt(port, 10) : port;
    //? Opt-in: only auto-pick the next free port when explicitly enabled.
    //? Off by default because `SERVER_PORT` also drives `config.ts`'s
    //? `backendOrigin` / OAuth callback base and the Vite dev proxy target —
    //? silently moving the listen port would leave the frontend talking to the
    //? old one. Safe to enable for standalone / `npm run cluster` use where
    //? nothing else hardcodes the port.
    const autoIncrement = ['1', 'true'].includes(
      (process.env.SERVER_PORT_AUTO_INCREMENT ?? '').toLowerCase(),
    );

    const tryListen = (attemptPort: number): void => {
      const onError = (err: NodeJS.ErrnoException): void => {
        if (err.code !== 'EADDRINUSE') {
          reject(err);
          return;
        }
        if (autoIncrement) {
          getLogger().warn(
            `Port ${String(attemptPort)} is in use — trying ${String(attemptPort + 1)} (SERVER_PORT_AUTO_INCREMENT=1)`,
          );
          tryListen(attemptPort + 1);
          return;
        }
        //? Truthful failure. The old code unconditionally logged "running on
        //? :<port>" inside the listen callback even when the bind never
        //? succeeded, so an in-use port looked like a healthy boot. Surface
        //? the real problem and the two ways out instead.
        getLogger().error(
          `Port ${String(attemptPort)} is already in use — the server did NOT start. ` +
            `Another \`npm run server\` is probably still running (stop it), or set ` +
            `SERVER_PORT to a free port, or set SERVER_PORT_AUTO_INCREMENT=1 to auto-pick the next free port.`,
        );
        reject(err);
      };

      httpServer.once('error', onError);
      httpServer.listen(attemptPort, ip, () => {
        httpServer.off('error', onError);
        const config = getProjectConfig();
        if (config.logging.socketStartup || config.logging.devLogs) {
          getLogger().info(`Server is running on http://${ip}:${String(attemptPort)}/`);
        }
        callback?.();
        resolve(httpServer);
      });
    };

    tryListen(startPort);
  });

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
    await initDevTools();
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
      'Failed to write the boot UUID to Redis. Check REDIS_HOST / REDIS_PORT / REDIS_USER / REDIS_PASSWORD and that Redis is reachable.',
      { cause: bootUuidError },
    );
  }

  const httpServer: HttpServer = http.createServer((req, res) => {
    void handleHttpRequest(req, res, options);
  });

  //? Persistent error listener. `listenLuckyStackServer` attaches a ONE-OFF
  //? `error` handler only around the bind attempt; once listening, an async
  //? socket error (e.g. EMFILE under load, an abrupt peer reset surfacing at the
  //? server level) would otherwise be an unhandled `'error'` event and crash the
  //? process. Log it instead so the server stays up and the cause is visible.
  httpServer.on('error', (err: NodeJS.ErrnoException) => {
    //? EADDRINUSE during bind is owned by the one-off handler in
    //? `listenLuckyStackServer` (which rejects/retries); don't double-log it.
    if (err.code === 'EADDRINUSE') return;
    getLogger().error('[http-server] runtime error', err);
  });

  const { io: ioServer, adapterClients } = loadSocket(httpServer, {
    maxHttpBufferSize: options.maxHttpBufferSize,
  });

  const listen = (callback?: () => void): Promise<HttpServer> =>
    listenLuckyStackServer(httpServer, ip, port, callback);

  //? Idempotent graceful shutdown. A second call (e.g. SIGINT then SIGTERM, or a
  //? programmatic `stop()` racing a signal) returns the in-flight promise rather
  //? than running the teardown twice.
  let shutdownPromise: Promise<void> | null = null;
  const stop = (stopOptions: StopLuckyStackServerOptions = {}): Promise<void> => {
    shutdownPromise ??= runGracefulShutdown({ httpServer, ioServer, adapterClients }, stopOptions);
    return shutdownPromise;
  };

  //? Production signal wiring (MIS-016). In dev, `initDevTools` already installs
  //? fast `process.exit(0)` handlers (hot-reload supervisor restarts). In prod
  //? we run the FULL graceful shutdown and exit only after it settles — an
  //? orchestrator's SIGTERM should drain connections + flush trackers, not hard-
  //? kill. `process.once` so a repeated signal doesn't stack handlers; the
  //? `stop()` idempotency covers a SIGINT-then-SIGTERM sequence.
  if (!enableDevTools) {
    const handleSignal = (reason: 'SIGTERM' | 'SIGINT'): void => {
      void (async () => {
        await stop({ reason });
        //? Terminate AFTER the graceful drain completes. This is the process
        //? entry's signal handler (not deep library code) — an orchestrator's
        //? SIGTERM expects the process to exit once it has drained, so exiting
        //? here is correct. Mirrors the dev handlers in `initDevTools`.
        // eslint-disable-next-line unicorn/no-process-exit -- top-level signal handler, exits after graceful drain
        process.exit(0);
      })();
    };
    process.once('SIGTERM', () => { handleSignal('SIGTERM'); });
    process.once('SIGINT', () => { handleSignal('SIGINT'); });
  }

  return { httpServer, ioServer, listen, stop, close: stop };
};
