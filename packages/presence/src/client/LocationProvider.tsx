//? Framework-owned location syncer. When enabled via
//? `getProjectConfig().locationProviderEnabled`, every client-side route
//? change emits a socket `updateLocation` event to the server so other
//? sessions (presence indicators, "John is on /settings") can show it.
//?
//? Mount this once at the top of the route tree (it renders <Outlet/>).
//? No-op when the config flag is off.
//?
//? SECURITY: query strings routinely carry secrets (password-reset tokens,
//? OAuth `code`/`state`, invite codes). The server persists `searchParams` on
//? the session and may fan it out to peers, so by DEFAULT we send NO search
//? params — only the pathname. A consumer that genuinely needs specific,
//? non-sensitive query keys (e.g. `?tab=`) opts in via `searchParamFilter`,
//? an allowlist of keys (or a predicate). Never blanket-forward the whole query.

import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { getProjectConfig } from '@luckystack/core/client';
import { createLocationSender } from './locationSender';

export interface LocationProviderProps {
  /**
   * Which query-string keys may be forwarded to the server. Omitted/empty =
   * send no search params (the secure default). Pass an array to allowlist
   * specific keys, or a predicate `(key, value) => boolean` for finer control.
   */
  searchParamFilter?: string[] | ((key: string, value: string) => boolean);
}

export default function LocationProvider({ searchParamFilter }: LocationProviderProps = {}) {
  const location = useLocation();
  //? One de-duplicating sender per mount: an inline `searchParamFilter` array
  //? re-runs the effect on every parent render, but only a changed location is
  //? sent to the server.
  const [sendLocationUpdate] = useState(createLocationSender);

  useEffect(() => {
    if (!getProjectConfig().locationProviderEnabled) return;
    //? Use `location.search` from React Router's hook (always in sync with the
    //? current navigation) rather than `globalThis.location.search` (which may
    //? lag or be absent in SSR/test environments).
    void sendLocationUpdate(location.pathname, location.search, searchParamFilter);
  }, [location.pathname, location.search, searchParamFilter, sendLocationUpdate]);

  return <Outlet />;
}
