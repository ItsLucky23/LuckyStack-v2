//? Generated `apiMethodMap` registry. Replaces the prefix-heuristic
//? in `isGetMethod` (apiRequest.ts) so abort-controller selection uses
//? the actual HTTP method declared on the handler instead of guessing
//? from the name prefix.
//?
//? Wiring: the project's `src/_sockets/socketInitializer.ts` (or any boot
//? entry that imports `apiTypes.generated.ts`) calls
//? `registerApiMethodMap(apiMethodMap)` once at module load. Until then,
//? lookups return `undefined` and `isGetMethod` falls back to the
//? prefix heuristic (preserving previous behavior for transitional code).

export type HttpMethodLiteral = 'GET' | 'POST' | 'PUT' | 'DELETE';

export type ApiMethodMap = Record<string, Record<string, Record<string, HttpMethodLiteral>>>;

let activeMap: ApiMethodMap | null = null;

export const registerApiMethodMap = (map: ApiMethodMap): void => {
  activeMap = map;
};

export const getRegisteredApiMethod = (
  pagePath: string,
  apiName: string,
  version: string,
): HttpMethodLiteral | undefined => {
  if (!activeMap) return undefined;
  return activeMap[pagePath]?.[apiName]?.[version];
};

export const isApiMethodMapRegistered = (): boolean => activeMap !== null;
