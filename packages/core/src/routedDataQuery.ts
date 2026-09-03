//? The GET half of the routed-HTTP wire contract: a GET keeps its declared
//? method, so its payload can only ride the query string. The client
//? (`routedHttpInvocation.ts`) and the test-runner's Layer-5 `callApi` both
//? build that URL here, so the reserved key cannot drift between them. The
//? server reads the same key in `@luckystack/server` (`apiRoute.ts`).
//?
//? Import-free on purpose: the root `@luckystack/core` entry is server-safe
//? and must not pull the browser-only client modules in.

export const ROUTED_DATA_QUERY_KEY = '__luckystack_data';

/**
 * Append `data` to `path` as the reserved `__luckystack_data` query value
 * (JSON-encoded), plus any `extraParams`. Tolerates a `path` that already
 * carries a query string.
 */
export const buildRoutedGetUrl = (
  path: string,
  data: unknown,
  extraParams?: Record<string, string>,
): string => {
  const params = new URLSearchParams();
  params.set(ROUTED_DATA_QUERY_KEY, JSON.stringify(data));
  for (const [key, value] of Object.entries(extraParams ?? {})) params.set(key, value);
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}${params.toString()}`;
};
