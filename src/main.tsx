/* eslint-disable react-refresh/only-export-components -- tells linting to not get upset for exporting a non react hook in this file */
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider, useParams, useSearchParams } from 'react-router-dom'
import { Toaster } from 'sonner'
import 'src/index.css'
import 'src/scrollbar.css'
import VConsole from 'vconsole'

import { mobileConsole } from 'config'
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
}

// Wrapper to inject Next.js-style params and searchParams as props
const PageWrapper = ({ Page }: { Page: React.ComponentType<PageProps> }) => {
  const params = useParams();
  const [searchParams] = useSearchParams();
  const searchParamsObj = Object.fromEntries(searchParams);

  return <Page params={params} searchParams={searchParamsObj} />;
};

const getRoutes = (pages: Record<string, PageModule>) => {
  const routes = [];
  //? Track which final URL each registered page resolves to, so we can
  //? log an error when two different files compute the same route (e.g.
  //? `src/_test/admin/page.tsx` + `src/admin/page.tsx` both → `/admin`
  //? because `_test` is invisible-parent). Devkit's
  //? `assertNoDuplicatePageRoutes` blocks this at build time; this
  //? runtime guard prints a visible warning during dev too.
  const seenRoutes = new Map<string, string>();
  for (const path in pages) {
    const module = pages[path];
    if (!module) continue;

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

    //? Per-page middleware: when the page module exports one, register it
    //? against its route path. Framework's `<Middleware>` + `useRouter`
    //? prefer this over the global handler.
    if (module.middleware) {
      registerPageMiddleware(finalPath, module.middleware);
    }

    const template = module.template ?? 'plain';
    const Page = module.default;

    routes.push({
      path: finalPath,
      element: (
        <TemplateProvider key={`${template}-${finalPath}`} initialTemplate={template}>
          <PageWrapper Page={Page} />
        </TemplateProvider>
      ),
    });
  }

  return routes;
};

const prodPages = import.meta.glob([
  './**/*.tsx',
  './**/*.jsx',
  '!./docs/**',
  '!./**/docs/page.tsx',
  '!./**/_api/**',
  '!./**/_sync/**',
  '!./**/server/**',
  '!./**/_server/**',
  '!./**/docs/**',
  '!./**/*_server.tsx',
  '!./**/*_server.jsx'
], { eager: true });

const devPages = import.meta.glob([
  './**/*.tsx',
  './**/*.jsx'
], { eager: true });

const pagesUnknown = import.meta.env.PROD ? prodPages : devPages;

const pages: Record<string, PageModule> = pagesUnknown as Record<string, PageModule>;

const routes = getRoutes(pages);
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
  children: routes
}])

if (mobileConsole) { new VConsole(); }

const ErrorFallback = () => {
  const title = enJson.common['404'];
  const message = enJson.api.internalServerError;
  const btnText = "Refresh Page";

  return (
    <div className="w-full h-screen flex flex-col items-center justify-center bg-background text-foreground">
      <h1 className="text-2xl font-bold mb-4">{title}</h1>
      <p className="text-muted-foreground mb-4">{message}</p>
      <button
        onClick={() => { globalThis.location.reload(); }}
        className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90"
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