//? Location-update emitter behind `LocationProvider`, kept out of the .tsx so the
//? de-duplication is testable without a DOM renderer.

import { socket, socketEventNames, waitForSocket } from '@luckystack/core/client';

//? Same shape as `LocationProviderProps['searchParamFilter']`.
type SearchParamFilter = string[] | ((key: string, value: string) => boolean);

const buildSearchParams = (
  search: string,
  filter: SearchParamFilter | undefined,
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

/**
 * One sender per mounted provider. It emits only when the pathname or the
 * FILTERED params differ from the last emit: the documented usage passes an
 * inline array (`searchParamFilter={['tab']}`), a new reference on every parent
 * render, and each emit costs a server-side session lock + write + the
 * `onLocationUpdate` hook even when nothing moved.
 */
export const createLocationSender = (): (
  pathname: string,
  search: string,
  filter: SearchParamFilter | undefined,
) => Promise<void> => {
  let lastSentKey: string | null = null;
  return async (pathname, search, filter) => {
    const searchParams = buildSearchParams(search, filter);
    const key = JSON.stringify([pathname, searchParams]);
    if (key === lastSentKey) return;
    //? Claimed before the await so overlapping renders cannot double-send.
    lastSentKey = key;
    if (!await waitForSocket() || !socket) {
      //? Not delivered — let the next render retry instead of skipping it.
      if (lastSentKey === key) lastSentKey = null;
      return;
    }
    socket.emit(socketEventNames.updateLocation, { pathName: pathname, searchParams });
  };
};
