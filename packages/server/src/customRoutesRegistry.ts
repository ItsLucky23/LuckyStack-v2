//? Custom-route registry. Lets overlay files (luckystack/<package>/index.ts)
//? register HTTP route handlers without each one touching server/server.ts.
//?
//? Why a registry instead of a single function on CreateLuckyStackServerOptions:
//?   The overlay-folder pattern means multiple packages may want to add
//?   routes (docs-ui, an admin panel, a webhook receiver, ...). Each
//?   registers independently; the framework iterates them in the order they
//?   were registered, returning the first one that handles the request.
//?
//? The original `customRoutes` option on `CreateLuckyStackServerOptions`
//? still works — it's appended to the registry at boot and runs last.
//?
//? Two phases (see `CustomRoutePhase`): `'post-params'` (default — runs after
//? the body is parsed) and `'pre-params'` (runs before the body is read, so
//? the handler gets the raw `req` stream — webhooks + streaming uploads).

import type { CustomRouteHandler, CustomRoutePhase } from './types';

export interface RegisterCustomRouteOptions {
  /** Pipeline phase the handler runs in. Defaults to `'post-params'`. */
  phase?: CustomRoutePhase;
}

//? `handlers` backs the default `'post-params'` phase. `getCustomRoutes()`
//? returns this array by reference (callers + tests rely on the clear-in-place
//? semantics), so keep it as the post-params store.
const handlers: CustomRouteHandler[] = [];
const preParamsHandlers: CustomRouteHandler[] = [];

export const registerCustomRoute = (
  handler: CustomRouteHandler,
  options: RegisterCustomRouteOptions = {},
): void => {
  if (options.phase === 'pre-params') {
    preParamsHandlers.push(handler);
    return;
  }
  handlers.push(handler);
};

export const getCustomRoutes = (): readonly CustomRouteHandler[] => handlers;

export const getPreParamsCustomRoutes = (): readonly CustomRouteHandler[] => preParamsHandlers;

export const clearCustomRoutes = (): void => {
  handlers.length = 0;
  preParamsHandlers.length = 0;
};
