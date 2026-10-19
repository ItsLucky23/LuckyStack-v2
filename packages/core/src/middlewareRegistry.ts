//? Middleware handler registry. The framework's `Middleware` + `Router`
//? components (in `./react/`) call the registered handler on every
//? navigation change to decide whether the user is allowed on the target
//? route. Per-page `export const middleware` (see `registerPageMiddleware`
//? below) is the canonical path; a consumer wanting a cross-cutting GLOBAL
//? guard registers it from the client bootstrap (typically `main.tsx`) via
//? `registerMiddlewareHandler(...)`. No separate
//? `src/_functions/middlewareHandler.ts` file is required.

import type { BaseSessionLayout } from './sessionTypes';
import tryCatchSync from './tryCatchSync';

export interface MiddlewareInput {
  location: string;
  searchParams: Record<string, string>;
  session: BaseSessionLayout | null;
}

export type MiddlewareResult =
  | { success: true; redirect?: undefined; status?: undefined }
  //? Deny by sending the user somewhere else. Right for "you are not signed in"
  //? — `/login` is where the problem gets solved.
  | { success: false; redirect: string; status?: undefined }
  //? Deny IN PLACE: keep the requested URL and render a status state (403 for
  //? signed-in-but-not-allowed, 404 to hide a resource's existence). Redirecting
  //? an authenticated user who simply lacks a permission sends them somewhere
  //? that does not explain anything and loses the URL they were trying to reach.
  | { success: false; redirect?: undefined; status: number }
  | undefined;

/** Normalized decision derived from a {@link MiddlewareResult}. */
export type MiddlewareOutcome =
  | { kind: 'allow' }
  | { kind: 'redirect'; to: string }
  | { kind: 'deny'; status: number }
  | { kind: 'fallback' };

//? ONE interpretation of a middleware result, shared by the `<Middleware>`
//? component (direct URL hits) and `useRouter` (programmatic navigation). They
//? previously branched separately, which is how `useRouter` ended up silently
//? doing nothing for any result it did not recognise.
export const resolveMiddlewareOutcome = (result: MiddlewareResult): MiddlewareOutcome => {
  if (result?.success) return { kind: 'allow' };
  if (result?.redirect) return { kind: 'redirect', to: result.redirect };
  if (typeof result?.status === 'number') return { kind: 'deny', status: result.status };
  //? No result at all, or a malformed one — treat as "not allowed here" and let
  //? the caller fall back to a safe destination.
  return { kind: 'fallback' };
};

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

//? Pages register under their ROUTE PATTERN (lowercased, `[id]` → `:id`), but
//? React Router renders a page for more URLs than that string: any letter case,
//? a trailing slash, filled-in dynamic segments, percent-encoded segments and,
//? for a `<route>/*` pattern, sub-paths. An exact Map lookup on the URL missed
//? all of those and fell back to the allow-by-default global handler, so the
//? page rendered unguarded. Resolve against the patterns the way the router
//? matched them.
const splitPath = (path: string): string[] => {
  const withoutSuffix = path.split(/[?#]/, 1)[0] ?? '';
  return withoutSuffix.split('/').filter((segment) => segment.length > 0);
};

const decodeSegment = (segment: string): string => {
  const [error, decoded] = tryCatchSync(() => decodeURIComponent(segment));
  return error || decoded === null ? segment : decoded;
};

//? Higher is more specific: a literal segment beats `:param`, both beat a
//? trailing splat. Close enough to React Router's ranking for one page per
//? pattern.
const matchScore = (patternSegments: string[], pathSegments: string[]): number | null => {
  let score = 0;
  for (const [index, patternSegment] of patternSegments.entries()) {
    if (patternSegment === '*' && index === patternSegments.length - 1) return score + 1;
    const pathSegment = pathSegments[index];
    if (pathSegment === undefined) return null;
    if (patternSegment.startsWith(':')) {
      score += 2;
    } else if (patternSegment.toLowerCase() === pathSegment.toLowerCase()) {
      score += 3;
    } else {
      return null;
    }
  }
  return patternSegments.length === pathSegments.length ? score : null;
};

/**
 * Resolve the per-page middleware for a URL or navigation target. Ignores
 * letter case, trailing slashes, query and hash, fills `:param` segments and
 * honours a trailing `*` pattern.
 */
export const resolvePageMiddleware = (path: string): PageMiddleware | undefined => {
  const pathSegments = splitPath(path).map((segment) => decodeSegment(segment));
  let best: { score: number; middleware: PageMiddleware } | null = null;
  for (const [pattern, middleware] of pageMiddlewares) {
    const score = matchScore(splitPath(pattern), pathSegments);
    if (score !== null && (best === null || score > best.score)) best = { score, middleware };
  }
  return best?.middleware;
};

/** Test helper — drop every registered per-page middleware. */
export const clearPageMiddlewaresForTests = (): void => {
  pageMiddlewares.clear();
};
