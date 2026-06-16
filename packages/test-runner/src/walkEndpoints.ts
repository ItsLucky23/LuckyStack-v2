import type { EndpointDescriptor, HttpMethod, SyncMethodMap } from './types';

type ApiMethodMap = Partial<Record<string, Partial<Record<string, Partial<Record<string, string>>>>>>;

//? Must stay in sync with the `HttpMethod` union in types.ts. Only values that
//? appear in both sets are valid probes — anything else is an unrecognised method.
const VALID_HTTP_METHODS = new Set<HttpMethod>(['GET', 'POST', 'PUT', 'DELETE']);

const toHttpMethod = (raw: string): HttpMethod | null => {
  //? Guard against a stale or hand-edited generated map carrying an unrecognised
  //? method string. An unknown value would propagate silently as a typed HttpMethod
  //? and break every probe that uses it. Return null so the caller can skip it.
  const upper = raw.toUpperCase();
  for (const m of VALID_HTTP_METHODS) {
    if (m === upper) return m;
  }
  return null;
};

export const walkEndpoints = (apiMethodMap: ApiMethodMap): EndpointDescriptor[] => {
  const endpoints: EndpointDescriptor[] = [];
  for (const [page, nameMap] of Object.entries(apiMethodMap)) {
    if (!nameMap) continue;
    for (const [name, versionMap] of Object.entries(nameMap)) {
      if (!versionMap) continue;
      for (const [version, rawMethod] of Object.entries(versionMap)) {
        if (rawMethod === undefined) continue;
        const method = toHttpMethod(rawMethod);
        if (!method) {
          //? Unrecognised method in the generated map — log and skip rather than
          //? silently coercing, which would produce invalid probes.
          console.warn(`[test-runner] walkEndpoints: skipping api/${page}/${name}/${version} — unrecognised method '${rawMethod}' in apiMethodMap`);
          continue;
        }
        endpoints.push({
          page,
          name,
          version,
          method,
          fullPath: `api/${page}/${name}/${version}`,
        });
      }
    }
  }
  return endpoints;
};

//? Walk the generated `syncMethodMap` and produce a flat list of sync-route
//? descriptors. Each descriptor's `fullPath` is `sync/<page>/<name>/<version>`.
//? Sync routes always use POST over the HTTP-fallback transport regardless of
//? the declared method, so the method is hardcoded to `POST` here.
export const walkSyncEndpoints = (syncMethodMap: SyncMethodMap): EndpointDescriptor[] => {
  const endpoints: EndpointDescriptor[] = [];
  for (const [page, nameMap] of Object.entries(syncMethodMap)) {
    if (!nameMap) continue;
    for (const [name, versionMap] of Object.entries(nameMap)) {
      if (!versionMap) continue;
      for (const [version, method] of Object.entries(versionMap)) {
        if (method === undefined) continue;
        endpoints.push({
          page,
          name,
          version,
          method: 'POST',
          fullPath: `sync/${page}/${name}/${version}`,
        });
      }
    }
  }
  return endpoints;
};
