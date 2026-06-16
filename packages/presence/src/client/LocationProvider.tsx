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

import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import {
  getProjectConfig,
  socket,
  socketEventNames,
  waitForSocket,
} from '@luckystack/core/client';

export interface LocationProviderProps {
  /**
   * Which query-string keys may be forwarded to the server. Omitted/empty =
   * send no search params (the secure default). Pass an array to allowlist
   * specific keys, or a predicate `(key, value) => boolean` for finer control.
   */
  searchParamFilter?: string[] | ((key: string, value: string) => boolean);
}

const buildSearchParams = (
  search: string,
  filter: LocationProviderProps['searchParamFilter'],
): Record<string, string> => {
  if (!filter) return {};
  const allow = Array.isArray(filter)
    ? (key: string): boolean => filter.includes(key)
    : (key: string, value: string): boolean => filter(key, value);

  const searchParams: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(search)) {
    if (allow(key, value)) searchParams[key] = value;
  }
  return searchParams;
};

const sendLocationUpdate = async (
  pathname: string,
  search: string,
  filter: LocationProviderProps['searchParamFilter'],
): Promise<void> => {
  const searchParams = buildSearchParams(search, filter);
  if (!await waitForSocket()) return;
  if (!socket) return;
  socket.emit(socketEventNames.updateLocation, { pathName: pathname, searchParams });
};

export default function LocationProvider({ searchParamFilter }: LocationProviderProps = {}) {
  const location = useLocation();

  useEffect(() => {
    if (!getProjectConfig().locationProviderEnabled) return;
    //? Use `location.search` from React Router's hook (always in sync with the
    //? current navigation) rather than `globalThis.location.search` (which may
    //? lag or be absent in SSR/test environments).
    void sendLocationUpdate(location.pathname, location.search, searchParamFilter);
  }, [location.pathname, location.search, searchParamFilter]);

  return <Outlet />;
}
