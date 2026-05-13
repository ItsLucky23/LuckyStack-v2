/* eslint-disable react-refresh/only-export-components */
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider, useParams, useSearchParams } from 'react-router-dom';
import { Toaster } from 'sonner';
import 'src/index.css';

import {
  AvatarProvider,
  Middleware,
  TranslationProvider,
  registerMiddlewareHandler,
} from '@luckystack/core/client';
import { LocationProvider } from '@luckystack/presence/client';

import ErrorPage from 'src/_components/ErrorPage';
import { MenuHandlerProvider } from 'src/_components/MenuHandler';
import TemplateProvider from 'src/_components/templates/TemplateProvider';
import { SessionProvider } from 'src/_providers/SessionProvider';
import { SocketStatusProvider } from 'src/_providers/socketStatusProvider';

//? Side-effect import — registers the locale map + language source with
//? @luckystack/core. Imported once at the entry. The i18n-backed notifier
//? auto-registers via the @luckystack/core/client barrel above.
import 'luckystack/i18n/locales';

//? Register the project's middleware handler so framework's <Middleware />
//? + useRouter consult it on every route guard check.
import middlewareHandler from 'src/_functions/middlewareHandler';
registerMiddlewareHandler(middlewareHandler);

import type { Template } from 'src/_components/templates/TemplateProvider';

interface PageProps {
  params: Record<string, string | undefined>;
  searchParams: Record<string, string>;
}

interface PageModule {
  default: React.ComponentType<PageProps>;
  template?: Template;
}

//? Wrapper to inject Next.js-style params and searchParams as props.
const PageWrapper = ({ Page }: { Page: React.ComponentType<PageProps> }) => {
  const params = useParams();
  const [searchParams] = useSearchParams();
  const searchParamsObj = Object.fromEntries(searchParams);
  return <Page params={params} searchParams={searchParamsObj} />;
};

const getRoutes = (pages: Record<string, PageModule>) => {
  const routes = [];
  for (const path in pages) {
    const module = pages[path];
    const pathSegments = path.split('/');
    if (pathSegments.some(segment => segment.startsWith('_'))) continue;

    const normalizedPath = path.replace(/^\.\//, '').replace(/\.tsx$/, '').toLowerCase();
    const routePath = normalizedPath === '' ? '/' : normalizedPath;
    const subPath = routePath.endsWith('/page')
      ? routePath.slice(0, -5)
      : (routePath.endsWith('page') ? '/' : false);
    if (!subPath) continue;

    // eslint-disable-next-line unicorn/prefer-string-replace-all
    const finalPath = subPath.replace(/\[([^\]]+)\]/g, ':$1');

    const template = module.template ?? 'plain';
    const Page = module.default;

    routes.push({
      path: finalPath,
      element: (
        <TemplateProvider key={`${template}-${subPath}`} initialTemplate={template}>
          <PageWrapper Page={Page} />
        </TemplateProvider>
      ),
    });
  }
  return routes;
};

//? File-based routing: any `page.tsx` under `src/` becomes a route. Files in
//? folders prefixed with `_` (e.g. `_api/`, `_sync/`, `_components/`) are
//? private and never become routes.
const prodPages = import.meta.glob([
  './**/page.tsx',
  '!./**/_api/**',
  '!./**/_sync/**',
  '!./**/_server/**',
  '!./**/*_server.tsx',
], { eager: true });

const devPages = import.meta.glob([
  './**/page.tsx',
], { eager: true });

const pages = (import.meta.env.PROD ? prodPages : devPages) as Record<string, PageModule>;

const routes = getRoutes(pages);

//? Catch-all — any URL that doesn't match a page renders ErrorPage inside the
//? plain template wrapper. Middleware lets the framework intercept auth /
//? bootstrap state before painting.
routes.push({
  path: '*',
  element: (
    <TemplateProvider initialTemplate='plain'>
      <Middleware>
        <ErrorPage />
      </Middleware>
    </TemplateProvider>
  ),
});

const router = createBrowserRouter([{
  path: '/',
  element: <LocationProvider />,
  errorElement: <ErrorPage />,
  children: routes,
}]);

const root = document.querySelector('#root');
if (root) {
  createRoot(root).render(
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
  );
}
