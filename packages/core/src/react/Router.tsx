//? Wrapper around react-router-dom's `useNavigate` that runs the
//? registered middleware handler before navigating. Returns the guarded
//? navigate function. Use everywhere instead of `useNavigate` directly so
//? programmatic navigations honor the same auth/redirect rules as
//? `<Middleware>`-wrapped page renders.

import { useLocation, useNavigate } from 'react-router-dom';
import { getMiddlewareHandler, getPageMiddleware, resolveMiddlewareOutcome } from '../middlewareRegistry';
import { useSession } from './sessionContext';

const getParams = (locationSearch: string) => {
  const params = new URLSearchParams(locationSearch);
  const queryObject: Record<string, string> = {};
  for (const [key, value] of params.entries()) {
    queryObject[key] = value;
  }
  return queryObject;
};

export default function useRouter() {
  const navigateHandler = useNavigate();
  const location = useLocation();
  const { session } = useSession();

  const navigate = async (path: string) => {
    const queryObject = getParams(location.search);
    //? Per-page middleware first (declared via `export const middleware`
    //? on the target page.tsx), then the global fallback. Mirrors the
    //? `<Middleware>` component's resolution order so programmatic
    //? navigations honor the same guards as direct URL hits.
    const pageMw = getPageMiddleware(path);
    const handler = pageMw ?? getMiddlewareHandler();
    const result = await handler({ location: path, searchParams: queryObject, session });

    const outcome = resolveMiddlewareOutcome(result);
    if (outcome.kind === 'redirect') {
      return navigateHandler(outcome.to);
    }
    //? `allow` obviously navigates. So does `deny` — the target route's
    //? `<Middleware>` renders the status state THERE, which keeps the URL and
    //? shows why. Silently doing nothing (the old behaviour for anything that
    //? was not allow-or-redirect) makes the button look broken.
    if (outcome.kind === 'allow' || outcome.kind === 'deny') {
      return navigateHandler(path);
    }
    return;
  };

  return navigate;
}
