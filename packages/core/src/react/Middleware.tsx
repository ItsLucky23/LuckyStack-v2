//? Framework-owned route guard. Wraps protected pages — runs the registered
//? middleware handler (`registerMiddlewareHandler` in core) on every route
//? change and renders children only when allowed. Redirects via React
//? Router's `useNavigate` when the handler returns a redirect. Shows a
//? loader only after a 200ms delay so fast checks don't flash a spinner.

import { ReactNode, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { getMiddlewareHandler, getPageMiddleware } from '../middlewareRegistry';
import { useSession } from './sessionContext';

const LOADER_DELAY_MS = 200;

function MiddlewareLoader() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const id = globalThis.setTimeout(() => { setShow(true); }, LOADER_DELAY_MS);
    return () => { globalThis.clearTimeout(id); };
  }, []);

  if (!show) return null;

  return (
    <div className="w-full h-full flex items-center justify-center" aria-busy="true" aria-live="polite">
      <div
        className="w-8 h-8 rounded-full border-2 border-container2-border border-t-primary animate-spin"
        role="status"
        aria-label="Loading"
      />
    </div>
  );
}

export default function Middleware({ children }: { children: ReactNode }) {
  const [allowed, setAllowed] = useState(false);
  const [checking, setChecking] = useState(true);

  const location = useLocation();
  const navigate = useNavigate();
  const { session, sessionLoaded } = useSession();

  useEffect(() => {
    let isMounted = true;
    setAllowed(false);
    setChecking(true);

    void (async () => {
      const params = new URLSearchParams(location.search);
      const queryObject: Record<string, string> = {};
      for (const [key, value] of params.entries()) {
        queryObject[key] = value;
      }

      //? Wait for the SessionProvider to finish its initial fetch — up to
      //? 5 seconds. Without this, we'd evaluate the middleware against a
      //? not-yet-loaded session and bounce the user back to /login.
      let count = 0;
      while (!sessionLoaded) {
        await new Promise(res => setTimeout(res, 10));
        count++;
        if (count > 500) break;
      }

      //? Per-page middleware first (declared in each page.tsx via
      //? `export const middleware`), then the global fallback handler
      //? registered via `registerMiddlewareHandler`. This lets pages own
      //? their own guards while keeping a central catch-all for
      //? cross-cutting cases (server-reachability checks, analytics).
      const pageMw = getPageMiddleware(location.pathname);
      const handler = pageMw ?? getMiddlewareHandler();
      const result = await handler({
        location: location.pathname,
        searchParams: queryObject,
        session,
      });

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- isMounted intentional, see comment below
      if (!isMounted) return;

      if (result?.success) {
        setAllowed(true);
      } else if (result && !result.success && result.redirect) {
        void navigate(result.redirect);
      } else {
        void navigate(-1);
      }

      setChecking(false);
    })();

    //! isMounted check is load-bearing — without it, repeated middleware
    //? denials chain navigate(-1) and walk too far up history. Keep it.
    return () => {
      isMounted = false;
    };
  }, [location.pathname, location.search, navigate, session, sessionLoaded]);

  if (checking) return <MiddlewareLoader />;
  if (!allowed) return null;
  return <div className="w-full h-full">{children}</div>;
}
