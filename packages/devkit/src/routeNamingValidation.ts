import fs from 'node:fs';
import path from 'node:path';
import {
  API_VERSION_TOKEN_REGEX,
  isVersionedApiFileName,
  isVersionedSyncFileName,
  ROUTE_NAMING_RULES,
  SYNC_VERSION_TOKEN_REGEX,
} from './routeConventions';

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

const walkRouteFiles = (dir: string, results: string[] = []): string[] => {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const normalizedFullPath = normalizePath(fullPath);

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

    if (normalizedFullPath.includes('/_api/') || normalizedFullPath.includes('/_sync/')) {
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
  marker: '/_api/' | '/_sync/';
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

  if (normalizedFilePath.includes('/_api/')) {
    const apiRouteToken = getFileRouteToken({ normalizedFilePath, marker: '/_api/' });
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

  if (normalizedFilePath.includes('/_sync/')) {
    const syncRouteToken = getFileRouteToken({ normalizedFilePath, marker: '/_sync/' });
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
  const relativePath = normalizePath(path.relative(srcDir, filePath));
  const segments = relativePath.split('/');
  const apiIndex = segments.indexOf('_api');
  if (apiIndex === -1 || apiIndex === segments.length - 1) {
    return null;
  }

  const pageLocation = segments.slice(0, apiIndex).join('/');
  const apiFilePath = segments.slice(apiIndex + 1).join('/');
  const rawApiName = apiFilePath.replace(/\.ts$/, '');
  const versionMatch = rawApiName.match(API_VERSION_TOKEN_REGEX);
  if (!versionMatch) {
    return null;
  }

  const version = `v${versionMatch[1]}`;
  const apiName = rawApiName.replace(API_VERSION_TOKEN_REGEX, '');
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
  const relativePath = normalizePath(path.relative(srcDir, filePath));
  const segments = relativePath.split('/');
  const syncIndex = segments.indexOf('_sync');
  if (syncIndex === -1 || syncIndex === segments.length - 1) {
    return null;
  }

  const pageLocation = segments.slice(0, syncIndex).join('/');
  const syncFilePath = segments.slice(syncIndex + 1).join('/');
  const rawSyncName = syncFilePath.replace(/\.ts$/, '');
  const syncMatch = rawSyncName.match(SYNC_VERSION_TOKEN_REGEX);
  if (!syncMatch) {
    return null;
  }

  const kind = syncMatch[1];
  const version = `v${syncMatch[2]}`;
  const syncName = rawSyncName.replace(SYNC_VERSION_TOKEN_REGEX, '');
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

  for (const filePath of allRouteFiles) {
    const normalizedFilePath = normalizePath(path.resolve(filePath));

    if (normalizedFilePath.includes('/_api/')) {
      const routeKey = resolveApiRouteKey({ srcDir, filePath });
      if (!routeKey) {
        continue;
      }

      if (!routeKeyToFilePaths.has(routeKey)) {
        routeKeyToFilePaths.set(routeKey, []);
      }
      routeKeyToFilePaths.get(routeKey)!.push(normalizedFilePath);
      routeKeyKinds.set(routeKey, 'api');
      continue;
    }

    if (normalizedFilePath.includes('/_sync/')) {
      const routeKey = resolveSyncRouteKey({ srcDir, filePath });
      if (!routeKey) {
        continue;
      }

      if (!routeKeyToFilePaths.has(routeKey)) {
        routeKeyToFilePaths.set(routeKey, []);
      }
      routeKeyToFilePaths.get(routeKey)!.push(normalizedFilePath);
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