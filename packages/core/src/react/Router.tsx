//? Wrapper around react-router-dom's `useNavigate` that runs the
//? registered middleware handler before navigating. Returns the guarded
//? navigate function. Use everywhere instead of `useNavigate` directly so
//? programmatic navigations honor the same auth/redirect rules as
//? `<Middleware>`-wrapped page renders.

import { useLocation, useNavigate } from 'react-router-dom';
import { getMiddlewareHandler, getPageMiddleware } from '../middlewareRegistry';
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

    if (result?.success) {
      return navigateHandler(path);
    }
    if (result && !result.success && result.redirect) {
      return navigateHandler(result.redirect);
    }
    return;
  };

  return navigate;
}
