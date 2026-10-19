//? Framework-owned route guard. Wraps protected pages — runs the registered
//? middleware handler (`registerMiddlewareHandler` in core) on every route
//? change and renders children only when allowed. Redirects via React
//? Router's `useNavigate` when the handler returns a redirect. Shows a
//? loader only after a 200ms delay so fast checks don't flash a spinner.

import { ReactNode, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { getMiddlewareHandler, resolveMiddlewareOutcome, resolvePageMiddleware } from '../middlewareRegistry';
import { useSession } from './sessionContext';
import { getProjectConfig } from '../projectConfig';

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

//? Built-in deny view. Deliberately NOT translated: `translate()` returns the
//? KEY when it cannot resolve one, so shipping `middleware.forbidden.title`
//? here would print that literal string in every project that upgrades without
//? adding the keys. Consumers who want their own copy (translated, branded,
//? with a "request access" action) pass the `denied` prop.
function MiddlewareDenied({ status }: { status: number }) {
  return (
    <div className="w-full h-full flex items-center justify-center p-6" role="alert">
      <div className="text-center max-w-md">
        <div className="text-4xl font-bold text-title mb-2">{status}</div>
        <div className="text-common">
          {status === 404
            ? 'This page does not exist.'
            : 'You do not have permission to view this page.'}
        </div>
      </div>
    </div>
  );
}

export default function Middleware({
  children,
  denied,
}: {
  children: ReactNode;
  /**
   * Rendered instead of the page when middleware denies IN PLACE
   * (`{ success: false, status }`) — the URL is kept. Pass a node, or a
   * function to vary by status. Defaults to a minimal built-in view.
   */
  denied?: ReactNode | ((status: number) => ReactNode);
}) {
  const [allowed, setAllowed] = useState(false);
  const [checking, setChecking] = useState(true);
  const [deniedStatus, setDeniedStatus] = useState<number | null>(null);

  const location = useLocation();
  const navigate = useNavigate();
  const { session, sessionLoaded } = useSession();

  //? Track the guarded route so a SESSION-only change re-evaluates the guard
  //? WITHOUT unmounting the page. A session update (avatar, roomCodes,
  //? preferences pushed via `updateSession`) used to flip `checking` back to
  //? true on every change → the whole page unmounted + remounted, wiping page
  //? state and aborting in-flight work. Joining a room (which saves the session
  //? and broadcasts `updateSession`) therefore looked like a full page refresh.
  //? Now we only show the loader / hide the page on a real ROUTE change; a bare
  //? session change re-checks in the background and only navigates away if the
  //? new session is no longer allowed.
  const routeKey = `${location.pathname} ${location.search}`;
  const guardedRouteRef = useRef<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const isRouteChange = guardedRouteRef.current !== routeKey;
    guardedRouteRef.current = routeKey;
    if (isRouteChange) {
      setAllowed(false);
      setChecking(true);
      //? Clear a previous route's deny so it can't flash on the new one.
      setDeniedStatus(null);
    }

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
      //? cross-cutting cases (server-reachability checks, analytics). Resolved
      //? against the registered route patterns, not by exact URL, so
      //? `/ADMIN`, `/admin/` and `/orders/123` hit their page's guard.
      const pageMw = resolvePageMiddleware(location.pathname);
      const handler = pageMw ?? getMiddlewareHandler();
      const result = await handler({
        location: location.pathname,
        searchParams: queryObject,
        session,
      });

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- isMounted intentional, see comment below
      if (!isMounted) return;

      const outcome = resolveMiddlewareOutcome(result);
      if (outcome.kind === 'allow') {
        setDeniedStatus(null);
        setAllowed(true);
      } else if (outcome.kind === 'redirect') {
        void navigate(outcome.to);
      } else if (outcome.kind === 'deny') {
        //? Stay on the requested URL and show why. Redirecting a signed-in user
        //? who merely lacks a permission loses the URL and explains nothing.
        setDeniedStatus(outcome.status);
      } else {
        //? Navigate to a safe, deterministic fallback instead of `navigate(-1)`,
        //? which chains backwards out of the app on repeated denials (e.g. when
        //? history is shallow or the previous page was also guarded).
        void navigate(getProjectConfig().loginRedirectUrl ?? '/');
      }

      setChecking(false);
    })();

    //! isMounted check is load-bearing — without it, repeated middleware
    //? denials chain navigate(-1) and walk too far up history. Keep it.
    return () => {
      isMounted = false;
    };
  }, [routeKey, location.pathname, location.search, navigate, session, sessionLoaded]);

  if (checking) return <MiddlewareLoader />;
  if (deniedStatus !== null) {
    const custom = typeof denied === 'function' ? denied(deniedStatus) : denied;
    return <div className="w-full h-full">{custom ?? <MiddlewareDenied status={deniedStatus} />}</div>;
  }
  if (!allowed) return null;
  return <div className="w-full h-full">{children}</div>;
}
