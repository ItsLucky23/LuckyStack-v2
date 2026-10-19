//? Route folder → service mapping for the production route-map generator
//? (`generateServerRequests.ts`). Kept in its own module so the build-time
//? ownership check can be tested without running the generator.

export interface RouteServicesConfig {
  services: Record<string, unknown>;
  presets: Record<string, { services: string[] }>;
}

/**
 * The service that owns a route file: its top-level `src/` folder, or `system`
 * for the root `src/_api` / `src/_sync`. This is the same first segment the
 * router reads from `/api/<service>/...`.
 */
export const extractServiceFromPath = (workspaceRelativePath: string): string => {
  // path starts with src/
  // Either src/_api/... (system) or src/vehicles/_api/... (vehicles)
  const segments = workspaceRelativePath.split('/');
  if (segments.length > 1 && (segments[1] === '_api' || segments[1] === '_sync')) {
    return 'system';
  }
  return segments[1] || 'system';
};

/**
 * Fail the build when a route folder's service is not declared in
 * services.config.ts or belongs to no preset.
 *
 * Each preset bundle only takes the routes of its own services, so such a
 * route would land in NO production bundle. Dev still serves it through the
 * live devkit loader, which is exactly the silent dev/prod divergence ADR 0046
 * makes the build fail on.
 */
export const assertRouteServicesDeclared = (
  workspaceRelativePaths: readonly string[],
  config: RouteServicesConfig,
): void => {
  const inPreset = new Set(Object.values(config.presets).flatMap((preset) => preset.services));
  const missing = new Map<string, string[]>();
  for (const routePath of workspaceRelativePaths) {
    const service = extractServiceFromPath(routePath);
    if (Object.hasOwn(config.services, service) && inPreset.has(service)) continue;
    missing.set(service, [...(missing.get(service) ?? []), routePath]);
  }
  if (missing.size === 0) return;

  const lines = [...missing].map(([service, files]) => {
    const problem = Object.hasOwn(config.services, service) ? 'is in no preset' : 'is not declared';
    return `  - '${service}' ${problem} (${files.length} route file(s), e.g. ${files[0] ?? ''})`;
  });
  throw new Error(
    `[generateServerRequests] Route folders whose service would be left out of every production bundle:\n${lines.join('\n')}\n`
    + `Declare each folder as a service in services.config.ts (e.g. \`settings: { source: 'settings' }\`) and add it to exactly one preset.`,
  );
};
