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

import type { CustomRouteHandler } from './types';

const handlers: CustomRouteHandler[] = [];

export const registerCustomRoute = (handler: CustomRouteHandler): void => {
  handlers.push(handler);
};

export const getCustomRoutes = (): readonly CustomRouteHandler[] => handlers;

export const clearCustomRoutes = (): void => {
  handlers.length = 0;
};
