import type { IncomingMessage, ServerResponse, Server as HttpServer } from 'node:http';
import type { Server as SocketIOServer } from 'socket.io';

export interface RouteContext {
  routePath: string;
  method: string;
  queryString: string | undefined;
  token: string | null;
}

//? Return value is unused — call sites only `await` the handler. Typed as
//? `unknown` so consumers whose handlers return `ServerResponse` (Node's
//? fluent API) or `void` both type-check.
export type StaticFileHandler = (req: IncomingMessage, res: ServerResponse) => unknown;
export type FaviconHandler = (res: ServerResponse) => unknown;
export type CustomRouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext
) => Promise<boolean> | boolean;

export interface CreateLuckyStackServerOptions {
  /** Port the HTTP server listens on. Defaults to process.env.SERVER_PORT or 80. */
  port?: number | string;
  /** Bind address. Defaults to process.env.SERVER_IP or '127.0.0.1'. */
  ip?: string;
  /** Project-side static file handler (Vite output, etc.). Used as the catch-all. */
  serveFile?: StaticFileHandler;
  /** Project-side favicon handler. */
  serveFavicon?: FaviconHandler;
  /**
   * Optional pre-fallback hook for project-specific HTTP routes. Return `true`
   * if the route was handled (response ended). Return `false` (or omit return)
   * to fall through to the framework's static file serving.
   */
  customRoutes?: CustomRouteHandler;
  /**
   * Enable dev-mode tooling (devkit hot reload, REPL, console init).
   * Defaults to `process.env.NODE_ENV !== 'production'`.
   */
  enableDevTools?: boolean;
  /**
   * Maximum HTTP buffer size for socket.io. Defaults to 5 MB. Adjust if you
   * stream large payloads through sockets.
   */
  maxHttpBufferSize?: number;
  /** Fail boot if no DeployConfig has been registered. Default: false. */
  requireDeployConfig?: boolean;
  /** Fail boot if no ServicesConfig has been registered. Default: false. */
  requireServicesConfig?: boolean;
  /** Fail boot if no OAuth providers have been registered. Default: false. */
  requireOAuthProviders?: boolean;
  /**
   * Dynamic-import callback for production runtime maps. When provided, the
   * framework registers its built-in `RuntimeMapsProvider` and the consumer
   * no longer needs a hand-rolled `server/prod/runtimeMaps.ts`. Pass a
   * function that calls `import()` with a path relative to the consumer's
   * server module — the framework cannot resolve that path on the
   * consumer's behalf because dynamic-import resolution is module-scoped.
   *
   * @example
   * loadGeneratedMaps: (preset) => import(`./prod/generatedApis.${preset}`)
   */
  loadGeneratedMaps?: (preset: string) => Promise<unknown>;
  /**
   * Override the env var that selects the production maps preset. Default
   * `LUCKYSTACK_BUNDLE`. Resolved to `'default'` when unset.
   */
  runtimeMapsPresetEnvVar?: string;
  /**
   * Override the literal preset name (skips env lookup). Useful in tests.
   */
  runtimeMapsPreset?: string;
}

export interface RunningLuckyStackServer {
  httpServer: HttpServer;
  ioServer: SocketIOServer;
  /**
   * Start listening. Resolves when the HTTP server is ready. Logs the bound
   * URL on success.
   */
  listen: (callback?: () => void) => Promise<HttpServer>;
}
