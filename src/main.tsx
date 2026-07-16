/* eslint-disable react-refresh/only-export-components -- tells linting to not get upset for exporting a non react hook in this file */
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider, useParams, useSearchParams } from 'react-router-dom'
import type { RouteObject } from 'react-router-dom'
import { Toaster } from 'sonner'
import 'src/index.css'
import 'src/scrollbar.css'

import { mobileConsole, sessionBasedToken } from 'config'
import { LocationProvider } from '@luckystack/presence/client'
import {
  AvatarProvider,
  Middleware,
  TranslationProvider,
  registerLocales,
  registerLanguageSource,
  registerPageMiddleware,
  validatePagePath,
} from '@luckystack/core/client'
import type { PageMiddleware } from '@luckystack/core/client'
import enJson from "src/_locales/en.json"
import nlJson from "src/_locales/nl.json"
import deJson from "src/_locales/de.json"
import frJson from "src/_locales/fr.json"

import ErrorPage from './_components/ErrorPage';
import { MenuHandlerProvider } from './_components/MenuHandler'
import TemplateProvider from './_components/TemplateProvider'
import { initializeSentry, SentryErrorBoundary } from './_functions/sentry'
import { SessionProvider, getCurrentSession } from './_providers/SessionProvider'
import { SocketStatusProvider } from './_providers/socketStatusProvider'

import type { Template } from './_components/TemplateProvider'

initializeSentry();

//? Register translations + active language source so the framework's
//? TranslationProvider + i18n notify can resolve keys without bundling
//? locale JSON inside the package.
registerLocales({ en: enJson, nl: nlJson, de: deJson, fr: frJson });
registerLanguageSource(() => getCurrentSession()?.language ?? null);

//? OAuth handoff for sessionStorage-token mode. The backend's /auth/callback
//? cannot Set-Cookie a sessionStorage token, so it 302s to `...?token=<token>`.
//? OAuth is a full-page navigation (no fetch to read an X-Session-Token header),
//? so we capture the token from the URL HERE — synchronously, before React mounts
//? (SessionProvider's socket connect + first `system/session` request both fire on
//? mount and read the token from sessionStorage). Then strip it from the URL via
//? replaceState so the long-lived token never lingers in the address bar, browser
//? history, or a Referer header. No-op in cookie mode (no ?token= is emitted).
if (sessionBasedToken) {
  const url = new URL(globalThis.location.href);
  const handoffToken = url.searchParams.get('token');
  if (handoffToken) {
    sessionStorage.setItem('token', handoffToken);
    url.searchParams.delete('token');
    globalThis.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  }
}

//? Per-page route guards live on each `page.tsx` via `export const middleware`
//? and are auto-registered below in `getRoutes()`. The framework's default
//? handler allows-by-default for unprotected routes — no central
//? `middlewareHandler.ts` is needed. To add a CROSS-CUTTING global hook
//? (telemetry, server-reachability check, maintenance banner), import
//? `registerMiddlewareHandler` from '@luckystack/core/client' and call it
//? here with your own function.

interface PageProps {
  params: Record<string, string | undefined>;
  searchParams: Record<string, string>;
}

interface PageModule {
  default: React.ComponentType<PageProps>;
  template?: Template;
  middleware?: PageMiddleware;
  //? Opt-in: register this page as a splat (`<route>/*`) so it owns all of its
  //? sub-paths. Use for a self-contained sub-app that keeps a persistent shell
  //? mounted and drives its own views/URLs from `useLocation` (e.g. the
  //? Workspaces app at `/workspaces/*`). Without this a page matches its exact
  //? route only.
  splat?: boolean;
}

// Wrapper to inject Next.js-style params and searchParams as props
const PageWrapper = ({ Page }: { Page: React.ComponentType<PageProps> }) => {
  const params = useParams();
  const [searchParams] = useSearchParams();
  const searchParamsObj = Object.fromEntries(searchParams);

  return <Page params={params} searchParams={searchParamsObj} />;
};

type PageLoader = () => Promise<PageModule>;

//? Build the rendered element for a resolved page module: register its per-page
//? middleware (lives on the same module) and wrap it in its chosen template.
const buildPageElement = (module: PageModule, finalPath: string) => {
  if (module.middleware) {
    registerPageMiddleware(finalPath, module.middleware);
  }
  const template = module.template ?? 'plain';
  return (
    <TemplateProvider key={`${template}-${finalPath}`} initialTemplate={template}>
      <PageWrapper Page={module.default} />
    </TemplateProvider>
  );
};

const splatFallbackElement = (
  <TemplateProvider initialTemplate='plain'>
    <Middleware>
      <ErrorPage />
    </Middleware>
  </TemplateProvider>
);

const getRoutes = (loaders: Record<string, PageLoader>): RouteObject[] => {
  const routes: RouteObject[] = [];
  //? Track which final URL each registered page resolves to, so we can
  //? log an error when two different files compute the same route (e.g.
  //? `src/_test/admin/page.tsx` + `src/admin/page.tsx` both → `/admin`
  //? because `_test` is invisible-parent). Devkit's
  //? `assertNoDuplicatePageRoutes` blocks this at build time; this
  //? runtime guard prints a visible warning during dev too.
  const seenRoutes = new Map<string, string>();
  for (const path in loaders) {
    const loader = loaders[path];
    if (!loader) continue;

    //? Only `page.tsx` files become routes. Filename is the last segment;
    //? skip everything else (component files, helpers, etc.).
    const result = validatePagePath(path);
    if (!result.valid || !result.route) {
      //? Surface invalid placements (e.g. `_housing/page.tsx`, or a page
      //? inside a reserved framework folder) as a dev console warning so
      //? developers don't silently lose a route. Filter "not a page file"
      //? to keep noise down — that's the common case for component files.
      if (import.meta.env.DEV && result.reason && !result.reason.startsWith('not a page file')) {
        console.warn(`[luckystack] page route skipped for ${path}: ${result.reason}`);
      }
      continue;
    }

    //? Lowercase + dynamic-param syntax conversion. validatePagePath uses
    //? case-preserving segments; React Router routes match case-insensitively
    //? by convention so we lowercase here. `[param]` -> `:param`.
    // eslint-disable-next-line unicorn/prefer-string-replace-all
    const finalPath = result.route.toLowerCase().replace(/\[([^\]]+)\]/g, ':$1');

    //? Collision check: if another page already claimed this finalPath,
    //? log a loud error pointing at both files and skip the second
    //? registration (first-wins, same as React Router's default).
    const previousFile = seenRoutes.get(finalPath);
    if (previousFile !== undefined) {
      console.error(
        `[luckystack] duplicate page route "${finalPath}": ${previousFile} AND ${path} both resolve here. ` +
        `Keeping the first; the second will not render. ` +
        `Remember that "_<folder>" segments are stripped from the URL (invisible-parent rule).`,
      );
      continue;
    }
    seenRoutes.set(finalPath, path);

    //? Lazy: the page component + its (often heavy) import tree load only when
    //? this route is actually visited, instead of every page eager-loading on
    //? first paint — which made even `/login` pull in all pages + their deps
    //? (a huge DevTools source-map parse). `template` and per-page `middleware`
    //? live on the same module, so they resolve inside the loader.
    routes.push({
      path: finalPath,
      lazy: async () => ({ element: buildPageElement(await loader(), finalPath) }),
    });

    //? Splat pages own their whole sub-tree (`/workspaces/*`). We can't read the
    //? `splat` export without loading the (heavy) component, which would defeat
    //? lazy-loading — so instead we register a sub-tree route for EVERY non-root
    //? page and decide at load time: if the page opts into `splat`, it renders
    //? for the whole sub-tree; otherwise the sub-path is a 404 (ErrorPage). The
    //? module load on an invalid sub-path is negligible (only on bad navigation).
    if (finalPath !== '/') {
      routes.push({
        path: `${finalPath}/*`,
        lazy: async () => {
          const module = await loader();
          return { element: module.splat ? buildPageElement(module, finalPath) : splatFallbackElement };
        },
      });
    }
  }

  return routes;
};

//? LAZY page loaders (`eager: false`) → `Record<path, () => Promise<Module>>`.
//? Each page (and its import tree) is only fetched when its route is visited,
//? instead of every page eager-loading on first paint — which made even `/login`
//? pull in all pages + their deps (heavy bundle + huge DevTools source-map parse).
const prodPages = import.meta.glob([
  './**/page.tsx',
  './**/page.jsx',
  '!./docs/**',
  '!./**/docs/page.tsx',
  '!./**/_api/**',
  '!./**/_sync/**',
  '!./**/server/**',
  '!./**/_server/**',
  '!./**/docs/**',
  '!./**/*_server.tsx',
  '!./**/*_server.jsx',
  '!./playground/**'
]);

const devPages = import.meta.glob([
  './**/page.tsx',
  './**/page.jsx'
]);

const pagesUnknown = import.meta.env.PROD ? prodPages : devPages;

const loaders = pagesUnknown as Record<string, PageLoader>;

const routes = getRoutes(loaders);
routes.push({
  path: '*',
  element: (
    <TemplateProvider initialTemplate='plain'>
      <Middleware>
        <ErrorPage />
      </Middleware>
    </TemplateProvider>
  )
});

const router = createBrowserRouter([{
  path: '/',
  element: <LocationProvider />,
  errorElement: <ErrorPage />,
  //? Lazy routes make this a data router that hydrates async; React Router 7
  //? warns without a HydrateFallback for the initial chunk load. `() => null`
  //? renders nothing during that brief window (no flash) and silences the warn.
  HydrateFallback: () => null,
  children: routes
}])

//? Dev-only by design: vconsole contains direct eval and must never enter a
//? production artifact. The compile-time DEV guard lets Vite remove the dynamic
//? import completely; the config toggle then controls local mobile debugging.
if (import.meta.env.DEV && mobileConsole) {
  const { default: VConsole } = await import('vconsole');
  new VConsole();
}

const ErrorFallback = () => {
  //? ErrorFallback is rendered outside the React provider tree (Sentry boundary),
  //? so useTranslator is unavailable. Access the English JSON directly — the
  //? user's language preference cannot be resolved during a crash.
  const title = enJson.common.unexpectedError;
  const message = enJson.api.internalServerError;
  const btnText = enJson.common.refreshPage;

  return (
    <div className="w-full h-screen flex flex-col items-center justify-center bg-background text-title">
      <h1 className="text-2xl font-bold mb-4">{title}</h1>
      <p className="text-common mb-4">{message}</p>
      <button
        type="button"
        onClick={() => { globalThis.location.reload(); }}
        className="px-4 py-2 bg-primary text-title-primary rounded-md hover:bg-primary-hover transition-colors cursor-pointer"
      >
        {btnText}
      </button>
    </div>
  );
};

const root = document.querySelector("#root");
if (root) {
  createRoot(root).render(
    <SentryErrorBoundary fallback={<ErrorFallback />}>
      <div className='w-full h-safe m-0 p-0 overflow-hidden'>
        <Toaster richColors />
        <SocketStatusProvider>
          <SessionProvider>
            <TranslationProvider>
              <AvatarProvider>
                <MenuHandlerProvider>
                  <RouterProvider router={router} />
                </MenuHandlerProvider>
              </AvatarProvider>
            </TranslationProvider>
          </SessionProvider>
        </SocketStatusProvider>
      </div>
    </SentryErrorBoundary>
  );
}