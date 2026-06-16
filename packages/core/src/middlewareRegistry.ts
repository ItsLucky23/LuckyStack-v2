//? Middleware handler registry. The framework's `Middleware` + `Router`
//? components (in `./react/`) call the registered handler on every
//? navigation change to decide whether the user is allowed on the target
//? route. Per-page `export const middleware` (see `registerPageMiddleware`
//? below) is the canonical path; a consumer wanting a cross-cutting GLOBAL
//? guard registers it from the client bootstrap (typically `main.tsx`) via
//? `registerMiddlewareHandler(...)`. No separate
//? `src/_functions/middlewareHandler.ts` file is required.

import type { BaseSessionLayout } from './sessionTypes';

export interface MiddlewareInput {
  location: string;
  searchParams: Record<string, string>;
  session: BaseSessionLayout | null;
}

export type MiddlewareResult =
  | { success: true; redirect?: undefined }
  | { success: false; redirect: string }
  | undefined;

export type MiddlewareHandler = (input: MiddlewareInput) => MiddlewareResult | Promise<MiddlewareResult>;

//? Default handler: allow by default. Per-page `middleware` exports on each
//? `page.tsx` are the canonical route-guard path (see `registerPageMiddleware`
//? below); the global handler is only consulted as a fallback for pages
//? that don't declare their own guard. Allowing-by-default keeps public
//? routes (`/`, `/login`, `/register`, ...) working without forcing every
//? consumer to ship a `src/_functions/middlewareHandler.ts` boilerplate
//? file just to opt-in to "let the user through".
//?
//? Consumers who need a cross-cutting global guard (telemetry, server-
//? reachability check, maintenance banner gate) call
//? `registerMiddlewareHandler(...)` directly from `main.tsx` with their own
//? function — no separate file required.
const DEFAULT_HANDLER: MiddlewareHandler = () => ({ success: true });

let activeHandler: MiddlewareHandler = DEFAULT_HANDLER;

export const registerMiddlewareHandler = (handler: MiddlewareHandler): void => {
  activeHandler = handler;
};

export const getMiddlewareHandler = (): MiddlewareHandler => activeHandler;

//? Per-page middleware registry. Counterpart to `registerMiddlewareHandler`
//? for the common case where each page declares its own guard locally
//? (`export const middleware = ({ session }) => {...}` from page.tsx).
//? The framework's `<Middleware>` component checks this map FIRST and only
//? falls back to the global handler when no per-page entry is registered.
//?
//? `PageMiddleware<TSession>` matches the existing `MiddlewareHandler`
//? signature so any handler shape is reusable on either side. The generic
//? is purely ergonomic for consumer-side type narrowing — module
//? augmentation of `BaseSessionLayout` flows through.

export type PageMiddleware<TSession extends BaseSessionLayout = BaseSessionLayout> = (
  input: { location: string; searchParams: Record<string, string>; session: TSession | null },
) => MiddlewareResult | Promise<MiddlewareResult>;

const pageMiddlewares = new Map<string, PageMiddleware>();

export const registerPageMiddleware = (path: string, middleware: PageMiddleware): void => {
  pageMiddlewares.set(path, middleware);
};

export const getPageMiddleware = (path: string): PageMiddleware | undefined =>
  pageMiddlewares.get(path);

export const hasPageMiddleware = (path: string): boolean => pageMiddlewares.has(path);

/** Test helper — drop every registered per-page middleware. */
export const clearPageMiddlewaresForTests = (): void => {
  pageMiddlewares.clear();
};
