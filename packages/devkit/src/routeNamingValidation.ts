import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from '@luckystack/core';
import {
  isVersionedApiFileName,
  isVersionedSyncFileName,
  ROUTE_NAMING_RULES,
} from './routeConventions';
import {
  apiMarkerSegment,
  syncMarkerSegment,
  getRoutingRules,
  isRouteTestFile,
  validatePagePath,
} from './routingRules';
import { getOrInit } from './internal/mapUtils';

export interface RouteNamingIssue {
  kind: 'api' | 'sync';
  filePath: string;
  reason: string;
  expected: string;
}

export interface DuplicateRouteKeyIssue {
  kind: 'api' | 'sync';
  routeKey: string;
  filePaths: string[];
}

const normalizePath = (value: string): string => {
  return value.replaceAll('\\', '/');
};

const toRel = (absolute: string): string =>
  path.relative(ROOT_DIR, absolute).replaceAll('\\', '/');

//? DEVKIT-5: a path segment that starts with the private-folder prefix (`_`)
//? AND sits AFTER the `_api`/`_sync` marker marks a private helper subtree
//? (e.g. `_api/_lib/*`, `_sync/_lib/__tests__/*`). Those are ordinary modules,
//? not routes, so route discovery + naming validation must skip them — exactly
//? like the invisible `_`-prefixed PAGE folders are skipped elsewhere. The
//? marker itself is excluded from the check (it also starts with `_`).
export const isInsidePrivateRouteSubfolder = (fullPath: string): boolean => {
  //? Use the BARE marker segment names (`_api` / `_sync`). `apiMarkerSegment()`
  //? returns the slash-wrapped `/_api/` form used for substring matching, which
  //? never equals a split path segment.
  const { privateFolderPrefix, apiMarker, syncMarker } = getRoutingRules();
  const segments = normalizePath(fullPath).split('/');
  const markerIndex = segments.findIndex((segment) => segment === apiMarker || segment === syncMarker);
  if (markerIndex === -1) return false;
  return segments.slice(markerIndex + 1).some((segment) => segment.startsWith(privateFolderPrefix));
};

const walkRouteFiles = (dir: string, results: string[] = []): string[] => {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const apiSeg = apiMarkerSegment();
  const syncSeg = syncMarkerSegment();
  const { ignore } = getRoutingRules();

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const normalizedFullPath = normalizePath(fullPath);

    if (ignore(toRel(fullPath))) continue;

    //? Private helper subtree under a marker (`_api/_lib/…`) — not a route.
    if (isInsidePrivateRouteSubfolder(fullPath)) continue;

    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') {
        continue;
      }

      walkRouteFiles(fullPath, results);
      continue;
    }

    if (!entry.isFile() || !entry.name.endsWith('.ts')) {
      continue;
    }

    if (isRouteTestFile(entry.name)) {
      continue;
    }

    if (normalizedFullPath.includes(apiSeg) || normalizedFullPath.includes(syncSeg)) {
      results.push(fullPath);
    }
  }

  return results;
};

const getFileRouteToken = ({
  normalizedFilePath,
  marker,
}: {
  normalizedFilePath: string;
  marker: string;
}): string => {
  const markerIndex = normalizedFilePath.indexOf(marker);
  if (markerIndex === -1) {
    return '';
  }

  const tokenStart = markerIndex + marker.length;
  return normalizedFilePath.slice(tokenStart, normalizedFilePath.length - '.ts'.length);
};

const validateRouteFilePath = (filePath: string): RouteNamingIssue[] => {
  const issues: RouteNamingIssue[] = [];
  const normalizedFilePath = normalizePath(path.resolve(filePath));
  const fileName = path.basename(filePath);
  const apiSeg = apiMarkerSegment();
  const syncSeg = syncMarkerSegment();

  if (normalizedFilePath.includes(apiSeg)) {
    const apiRouteToken = getFileRouteToken({ normalizedFilePath, marker: apiSeg });
    if (apiRouteToken.includes('/')) {
      issues.push({
        kind: 'api',
        filePath: normalizedFilePath,
        reason: 'API route token cannot contain nested path segments ("/").',
        expected: ROUTE_NAMING_RULES.api,
      });
    }

    if (!isVersionedApiFileName(fileName)) {
      issues.push({
        kind: 'api',
        filePath: normalizedFilePath,
        reason: 'API filename does not match versioned naming.',
        expected: ROUTE_NAMING_RULES.api,
      });
    }
  }

  if (normalizedFilePath.includes(syncSeg)) {
    const syncRouteToken = getFileRouteToken({ normalizedFilePath, marker: syncSeg });
    if (syncRouteToken.includes('/')) {
      issues.push({
        kind: 'sync',
        filePath: normalizedFilePath,
        reason: 'Sync route token cannot contain nested path segments ("/").',
        expected: `${ROUTE_NAMING_RULES.syncServer} or ${ROUTE_NAMING_RULES.syncClient}`,
      });
    }

    if (!isVersionedSyncFileName(fileName)) {
      issues.push({
        kind: 'sync',
        filePath: normalizedFilePath,
        reason: 'Sync filename does not match versioned naming.',
        expected: `${ROUTE_NAMING_RULES.syncServer} or ${ROUTE_NAMING_RULES.syncClient}`,
      });
    }
  }

  return issues;
};

const resolveApiRouteKey = ({
  srcDir,
  filePath,
}: {
  srcDir: string;
  filePath: string;
}): string | null => {
  const rules = getRoutingRules();
  const relativePath = normalizePath(path.relative(srcDir, filePath));
  const segments = relativePath.split('/');
  const apiIndex = segments.indexOf(rules.apiMarker);
  if (apiIndex === -1 || apiIndex === segments.length - 1) {
    return null;
  }

  const pageLocation = segments.slice(0, apiIndex).join('/');
  const apiFilePath = segments.slice(apiIndex + 1).join('/');
  const rawApiName = apiFilePath.replace(/\.ts$/, '');
  const versionMatch = rawApiName.match(rules.apiVersionRegex);
  if (!versionMatch) {
    return null;
  }

  const version = `v${versionMatch[1]}`;
  const apiName = rawApiName.replace(rules.apiVersionRegex, '');
  const mappedPageLocation = pageLocation || 'system';
  return `api/${mappedPageLocation}/${apiName}/${version}`;
};

const resolveSyncRouteKey = ({
  srcDir,
  filePath,
}: {
  srcDir: string;
  filePath: string;
}): string | null => {
  const rules = getRoutingRules();
  const relativePath = normalizePath(path.relative(srcDir, filePath));
  const segments = relativePath.split('/');
  const syncIndex = segments.indexOf(rules.syncMarker);
  if (syncIndex === -1 || syncIndex === segments.length - 1) {
    return null;
  }

  const pageLocation = segments.slice(0, syncIndex).join('/');
  const syncFilePath = segments.slice(syncIndex + 1).join('/');
  const rawSyncName = syncFilePath.replace(/\.ts$/, '');
  const syncMatch = rawSyncName.match(rules.syncVersionRegex);
  if (!syncMatch) {
    return null;
  }

  const kind = syncMatch[1];
  const version = `v${syncMatch[2]}`;
  const syncName = rawSyncName.replace(rules.syncVersionRegex, '');
  const routeBaseKey = pageLocation
    ? `sync/${pageLocation}/${syncName}/${version}`
    : `sync/${syncName}/${version}`;

  return `${routeBaseKey}_${kind}`;
};

export const collectInvalidRouteNamingIssues = (srcDir: string): RouteNamingIssue[] => {
  const allRouteFiles = walkRouteFiles(srcDir);
  const issues: RouteNamingIssue[] = [];

  for (const filePath of allRouteFiles) {
    issues.push(...validateRouteFilePath(filePath));
  }

  return issues.toSorted((a, b) => a.filePath.localeCompare(b.filePath));
};

export const collectDuplicateNormalizedRouteKeyIssues = (srcDir: string): DuplicateRouteKeyIssue[] => {
  const allRouteFiles = walkRouteFiles(srcDir);
  const routeKeyToFilePaths = new Map<string, string[]>();
  const routeKeyKinds = new Map<string, 'api' | 'sync'>();

  const apiSeg = apiMarkerSegment();
  const syncSeg = syncMarkerSegment();
  for (const filePath of allRouteFiles) {
    const normalizedFilePath = normalizePath(path.resolve(filePath));

    if (normalizedFilePath.includes(apiSeg)) {
      const routeKey = resolveApiRouteKey({ srcDir, filePath });
      if (!routeKey) {
        continue;
      }

      getOrInit(routeKeyToFilePaths, routeKey, () => []).push(normalizedFilePath);
      routeKeyKinds.set(routeKey, 'api');
      continue;
    }

    if (normalizedFilePath.includes(syncSeg)) {
      const routeKey = resolveSyncRouteKey({ srcDir, filePath });
      if (!routeKey) {
        continue;
      }

      getOrInit(routeKeyToFilePaths, routeKey, () => []).push(normalizedFilePath);
      routeKeyKinds.set(routeKey, 'sync');
    }
  }

  const issues: DuplicateRouteKeyIssue[] = [];
  for (const [routeKey, filePaths] of routeKeyToFilePaths.entries()) {
    if (filePaths.length < 2) {
      continue;
    }

    issues.push({
      kind: routeKeyKinds.get(routeKey) ?? 'api',
      routeKey,
      filePaths: filePaths.toSorted((a, b) => a.localeCompare(b)),
    });
  }

  return issues.toSorted((a, b) => a.routeKey.localeCompare(b.routeKey));
};

export const formatRouteNamingIssues = ({
  issues,
  context,
}: {
  issues: RouteNamingIssue[];
  context: string;
}): string => {
  const plural = issues.length === 1 ? '' : 's';
  const header = `[RouteNaming] Found ${issues.length} invalid API/sync route file${plural} while ${context}.`;
  const details = issues
    .map((issue, index) => {
      return `${index + 1}. [${issue.kind.toUpperCase()}] ${issue.filePath}\n   reason: ${issue.reason}\n   expected: ${issue.expected}`;
    })
    .join('\n');

  return `${header}\n${details}`;
};

export const formatDuplicateRouteKeyIssues = ({
  issues,
  context,
}: {
  issues: DuplicateRouteKeyIssue[];
  context: string;
}): string => {
  const plural = issues.length === 1 ? '' : 's';
  const header = `[RouteNaming] Found ${issues.length} duplicate normalized route key${plural} while ${context}.`;
  const details = issues
    .map((issue, index) => {
      const fileList = issue.filePaths.map((filePath) => `   - ${filePath}`).join('\n');
      return `${index + 1}. [${issue.kind.toUpperCase()}] ${issue.routeKey}\n   files:\n${fileList}`;
    })
    .join('\n');

  return `${header}\n${details}`;
};

export const assertValidRouteNaming = ({
  srcDir,
  context,
}: {
  srcDir: string;
  context: string;
}): void => {
  const issues = collectInvalidRouteNamingIssues(srcDir);
  if (issues.length === 0) {
    return;
  }

  throw new Error(formatRouteNamingIssues({ issues, context }));
};

export const assertNoDuplicateNormalizedRouteKeys = ({
  srcDir,
  context,
}: {
  srcDir: string;
  context: string;
}): void => {
  const issues = collectDuplicateNormalizedRouteKeyIssues(srcDir);
  if (issues.length === 0) {
    return;
  }

  throw new Error(formatDuplicateRouteKeyIssues({ issues, context }));
};

//? --- Duplicate-page-route detection ----------------------------------------
//? `validatePagePath` in @luckystack/core normalizes a `page.tsx` path into a
//? URL route by stripping invisible-parent folders (`_<name>`). Two files in
//? DIFFERENT folder trees can therefore compute the SAME route — e.g.
//? `src/_test/admin/page.tsx` AND `src/admin/page.tsx` both yield `/admin`.
//? React Router silently keeps the first registration; the second page is
//? lost without an error. This validator catches the collision at startup
//? + build time.

export interface DuplicatePageRouteIssue {
  /** Computed route after invisible-parent stripping (e.g. `/admin`). */
  route: string;
  /** All page.tsx files that resolve to this same route. */
  filePaths: string[];
}

const walkPageFiles = (dir: string, results: string[] = []): string[] => {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      walkPageFiles(fullPath, results);
      continue;
    }
    if (!entry.isFile()) continue;
    if (entry.name === 'page.tsx' || entry.name === 'page.jsx') {
      results.push(fullPath);
    }
  }
  return results;
};

export const collectDuplicatePageRoutes = (srcDir: string): DuplicatePageRouteIssue[] => {
  //? `validatePagePath` is a pure function (no registry side-effects) so
  //? top-level importing it is safe and doesn't drag any boot ordering.
  //? Previously this was a lazy `require()` call which crashed under ESM
  //? (`ReferenceError: require is not defined`); the import-at-the-top
  //? form works in both runtimes the package targets.
  const pageFiles = walkPageFiles(srcDir);
  const routeToFiles = new Map<string, string[]>();

  for (const absoluteFilePath of pageFiles) {
    const relative = normalizePath(path.relative(srcDir, absoluteFilePath));
    const result = validatePagePath(relative);
    if (!result.valid || !result.route) continue;
    const list = routeToFiles.get(result.route) ?? [];
    list.push(normalizePath(path.relative(ROOT_DIR, absoluteFilePath)));
    routeToFiles.set(result.route, list);
  }

  const issues: DuplicatePageRouteIssue[] = [];
  for (const [route, filePaths] of routeToFiles) {
    if (filePaths.length > 1) {
      issues.push({ route, filePaths });
    }
  }
  return issues;
};

export const formatDuplicatePageRouteIssues = ({
  issues,
  context,
}: {
  issues: DuplicatePageRouteIssue[];
  context: string;
}): string => {
  const plural = issues.length === 1 ? '' : 's';
  const header = `[RouteNaming] Found ${issues.length} duplicate page route${plural} while ${context}.`;
  const details = issues
    .map((issue, index) => {
      const fileList = issue.filePaths.map((filePath) => `   - ${filePath}`).join('\n');
      return `${index + 1}. ${issue.route}\n   files:\n${fileList}\n   fix: rename or move one of the files so only one page.tsx resolves to "${issue.route}". Remember that "_<folder>" segments are stripped from the URL (invisible-parent rule).`;
    })
    .join('\n');

  return `${header}\n${details}`;
};

export const assertNoDuplicatePageRoutes = ({
  srcDir,
  context,
}: {
  srcDir: string;
  context: string;
}): void => {
  const issues = collectDuplicatePageRoutes(srcDir);
  if (issues.length === 0) return;
  throw new Error(formatDuplicatePageRouteIssues({ issues, context }));
};