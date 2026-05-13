//? Framework-owned location syncer. When enabled via
//? `getProjectConfig().locationProviderEnabled`, every client-side route
//? change emits a socket `updateLocation` event to the server so other
//? sessions (presence indicators, "John is on /settings") can show it.
//?
//? Mount this once at the top of the route tree (it renders <Outlet/>).
//? No-op when the config flag is off.

import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import {
  getProjectConfig,
  socket,
  socketEventNames,
  waitForSocket,
} from '@luckystack/core/client';

const sendLocationUpdate = async (pathname: string): Promise<void> => {
  const searchParams: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(globalThis.location.search)) {
    searchParams[key] = value;
  }
  if (!await waitForSocket()) return;
  if (!socket) return;
  socket.emit(socketEventNames.updateLocation, { pathName: pathname, searchParams });
};

export default function LocationProvider() {
  const location = useLocation();

  useEffect(() => {
    if (!getProjectConfig().locationProviderEnabled) return;
    void sendLocationUpdate(location.pathname);
  }, [location.pathname]);

  return <Outlet />;
}
