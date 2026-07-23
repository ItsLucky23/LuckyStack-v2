import http, { type Server as HttpServer } from 'node:http';
import { registerBindAddress, registerBoundAddress, writeBootUuid, startBootUuidHeartbeat, getLogger, getProjectConfig, tryCatch, tryCatchSync, resolveEnvKey, dispatchHook } from '@luckystack/core';
import { handleHttpRequest } from './httpHandler';
import { loadSocket } from './loadSocket';
import { verifyBootstrap } from './verifyBootstrap';
import { registerProdRuntimeMapsProvider } from './runtimeMapsLoader';
import { getParsedPort } from './argv';
import { canResolve } from './capabilities';
import { runGracefulShutdown } from './stopServer';
import { writeDevServerInfo, clearDevServerInfo } from './devServerInfo';
import { markDevToolsInitFailed } from './devToolsStatus';
import { normalizeServerPort, resolveServerPort } from './portResolution';
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
 * - Boot-UUID write + heartbeat so readiness and router topology stay truthful
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
  //? Belt-and-braces: explicit SIGINT/SIGTERM handler so Ctrl+C is honored even
  //? if a sync CPU burst (TS Program build, large require chain) is still in
  //? flight when the signal arrives. Installed BEFORE the guarded devkit import
  //? so Ctrl+C still works when devkit is absent and we early-return below.
  //? Give `preServerStop` subscribers (cron lease release, tracker flush) a
  //? BOUNDED window before the hard exit — without it a dev Ctrl+C leaves the
  //? cron leader lease dangling until its TTL, so no jobs fire for up to 30s
  //? after every restart. Dev iteration speed still wins: 2s cap, then exit.
  const devSignalExit = (reason: 'SIGINT' | 'SIGTERM'): void => {
    void Promise.race([
      dispatchHook('preServerStop', { reason, timeoutMs: 2000 }),
      new Promise((resolve) => {
        setTimeout(resolve, 2000);
      }),
      // eslint-disable-next-line unicorn/no-process-exit -- deliberate dev hard-exit once the bounded hook window closes (mirrors the original inline handler)
    ]).finally(() => process.exit(0));
  };
  process.once('SIGINT', () => {
    devSignalExit('SIGINT');
  });
  process.once('SIGTERM', () => {
    devSignalExit('SIGTERM');
  });
  //? @luckystack/devkit is an OPTIONAL peer, normally ABSENT in production. If a
  //? deploy forgets `NODE_ENV=production`, enableDevTools stays true and an
  //? unguarded `import('@luckystack/devkit')` would crash boot with
  //? ERR_MODULE_NOT_FOUND. Resolve-guard + tryCatch (mirroring bootstrap.ts's
  //? optional-package imports) so a missing/broken devkit logs an actionable
  //? warning and boot continues instead of taking the whole server down.
  const devkitModuleId = '@luckystack/devkit';
  if (!canResolve(devkitModuleId)) {
    getLogger().warn(
      'dev tooling unavailable — @luckystack/devkit is not installed, so hot reload + type-map generation are off. Install it as a devDependency for dev, or set NODE_ENV=production to run in production mode.',
    );
    return;
  }
  const [devkitError] = await tryCatch(async () => {
    const devkit = (await import(devkitModuleId)) as {
      initializeAll: () => Promise<void>;
      setupWatchers: () => void;
    };
    await devkit.initializeAll();
    devkit.setupWatchers();
  });
  if (devkitError) {
    //? LOUD + self-explaining. The old `warn` scrolled past and left the server
    //? "up" but broken: `initializeAll()` clears `devApis`/`devSyncs` before it
    //? throws, so every /api + /sync route is dead, AND `setupWatchers()` (the
    //? next line above) never ran, so hot reload is OFF — the ONLY recovery is a
    //? restart after fixing the cause. Record it so `apiRoute.ts` can answer
    //? requests with the real reason instead of a misleading 404.
    markDevToolsInitFailed(devkitError);
    getLogger().error(
      'dev tooling FAILED to initialize — the server is running but EVERY /api and /sync route will fail until this is fixed. '
        + 'Hot reload is OFF (the file watchers never started), so fix the cause below and RESTART the server. '
        + `Cause: ${devkitError.message}`,
      devkitError,
    );
  }
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
    const startPort = normalizeServerPort(port);
    const environmentKey = resolveEnvKey();
    const production = environmentKey === 'production';
    const test = environmentKey === 'test';
    //? Auto-pick the next free port resolution:
    //? - When `SERVER_PORT_AUTO_INCREMENT` is set EXPLICITLY it always wins
    //?   (`1`/`true` -> on, `0`/`false` -> off), so a consumer can force either
    //?   behaviour in any environment.
    //? - When it is NOT set we default to ON in dev and OFF in production. One
    //?   canonical environment key (`LUCKYSTACK_ENV` before `NODE_ENV`) drives
    //?   auto-increment, OAuth rewriting, proxy advertisement, and dev tooling.
    //? Prod stays OFF by default because a silently moved direct listen port can
    //? leave external clients talking to the old one. In dev a clash is usually
    //? a leftover process, so hopping is the friendlier default.
    const autoIncrementEnv = (process.env.SERVER_PORT_AUTO_INCREMENT ?? '').toLowerCase();
    let autoIncrement: boolean;
    if (['0', 'false'].includes(autoIncrementEnv)) autoIncrement = false;
    else if (['1', 'true'].includes(autoIncrementEnv)) autoIncrement = true;
    else autoIncrement = !production;

    const tryListen = (attemptPort: number): void => {
      const onError = (err: NodeJS.ErrnoException): void => {
        if (err.code !== 'EADDRINUSE') {
          reject(err);
          return;
        }
        if (autoIncrement && attemptPort < 65_535) {
          getLogger().warn(
            `Port ${String(attemptPort)} is in use — trying ${String(attemptPort + 1)} (auto-increment; set SERVER_PORT_AUTO_INCREMENT=0 to disable). `
              + `A previous/zombie dev server is still holding :${String(attemptPort)}: a manual client pinned there will keep talking to the OLD process, while the Vite proxy follows this restart's advertised port. `
              + `If this restart was meant to replace it, stop the process on :${String(attemptPort)} first.`,
          );
          tryListen(attemptPort + 1);
          return;
        }
        if (autoIncrement) {
          const rangeError = new RangeError(
            'Port 65535 is already in use and auto-increment cannot select a valid higher TCP port.',
          );
          getLogger().error(rangeError.message);
          reject(rangeError);
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
        const address = httpServer.address();
        const boundPort = typeof address === 'object' && address !== null
          ? address.port
          : attemptPort;
        //? TRUTH-UP the bind registry with the port node:http ACTUALLY reports.
        //? Reading `address().port` matters for listen(0), where the OS chooses an
        //? ephemeral port that is different from the requested zero.
        registerBoundAddress({ ip, port: boundPort });
        //? Dev only: advertise the ACTUALLY-bound port so the Vite proxy follows
        //? us when auto-increment moved the listen off the configured port. Skipped
        //? in production and test environments. Best-effort — never blocks boot.
        if (!production && !test) {
          writeDevServerInfo(ip, boundPort);
          process.once('exit', clearDevServerInfo);
        }

        //? DRIFT WARNING (Fix 3). A hop now auto-corrects BOTH same-origin CORS
        //? (via the re-register above) AND the OAuth `redirect_uri` (the authorize
        //? + token-exchange steps rewrite a localhost callback port to the bound
        //? port via `resolveDevCallbackUrl`). So OAuth targets the LIVE server —
        //? but the one thing the framework cannot do for you is update your
        //? provider console: Google/GitHub still exact-match the registered
        //? redirect URI. Surface that remaining manual step loudly. Only on an
        //? ACTUAL hop, in dev, and only when the configured base names a different port.
        if (attemptPort !== startPort && !production) {
          //? Read the configured callback base defensively — a pure-server boot
          //? may not have registered projectConfig yet, and the slot defaults to ''.
          const configuredCallbackBase = tryCatchSync(() => getProjectConfig().oauthCallbackBase)[1] ?? '';
          const callbackPort = tryCatchSync(() => {
            const callbackUrl = new URL(configuredCallbackBase);
            return callbackUrl.port || (callbackUrl.protocol === 'https:' ? '443' : '80');
          })[1] ?? '';
          if (callbackPort === String(startPort) && callbackPort !== String(boundPort)) {
            getLogger().warn(
              `OAuth port drift: the server bound :${String(boundPort)} but your OAuth callback base is configured for :${callbackPort} `
                + `(${configuredCallbackBase}). The framework now auto-targets :${String(boundPort)} for OAuth so the callback reaches THIS server — `
                + `but your provider (Google/GitHub/…) still exact-matches its registered redirect URI, so add :${String(boundPort)} to the authorized `
                + `redirect URIs, OR set SERVER_PORT_AUTO_INCREMENT=0 to pin :${callbackPort} (stop whatever holds it) instead of hopping.`,
            );
          }
        }
        const config = getProjectConfig();
        if (config.logging.socketStartup || config.logging.devLogs) {
          getLogger().info(`Server is running on http://${ip}:${String(boundPort)}/`);
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

  const port = resolveServerPort({
    optionsPort: options.port,
    parsedPort: getParsedPort(),
    defaultPort: options.defaultPort,
    envPort: process.env.SERVER_PORT,
  });
  const ip = options.ip ?? process.env.SERVER_IP ?? '127.0.0.1';
  const enableDevTools = options.enableDevTools ?? resolveEnvKey() !== 'production';

  //? Register the resolved bind address so framework code that needs it
  //? (e.g. `checkOrigin` building the same-origin entry) doesn't drift when
  //? the consumer passed `options.ip`/`options.port` without also setting
  //? the legacy `SERVER_IP`/`SERVER_PORT` env vars.
  registerBindAddress({ ip, port });

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

  //? @adr 0036
  let bootUuidHeartbeat: ReturnType<typeof startBootUuidHeartbeat> | null = null;
  const listen = async (callback?: () => void): Promise<HttpServer> => {
    const listeningServer = await listenLuckyStackServer(httpServer, ip, port, callback);
    //? Start only after node:http is genuinely listening. The initial UUID was
    //? written before route construction, but a failed bind must not keep an
    //? environment advertising readiness through a background heartbeat.
    bootUuidHeartbeat ??= startBootUuidHeartbeat();
    return listeningServer;
  };

  //? Idempotent graceful shutdown. A second call (e.g. SIGINT then SIGTERM, or a
  //? programmatic `stop()` racing a signal) returns the in-flight promise rather
  //? than running the teardown twice.
  let shutdownPromise: Promise<void> | null = null;
  const stop = (stopOptions: StopLuckyStackServerOptions = {}): Promise<void> => {
    bootUuidHeartbeat?.stop();
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
