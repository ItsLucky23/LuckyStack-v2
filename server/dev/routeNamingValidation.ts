import fs from 'node:fs';
import path from 'node:path';
import {
  isVersionedApiFileName,
  isVersionedSyncFileName,
  ROUTE_NAMING_RULES,
} from './routeConventions';

export interface RouteNamingIssue {
  kind: 'api' | 'sync';
  filePath: string;
  reason: string;
  expected: string;
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

export const collectInvalidRouteNamingIssues = (srcDir: string): RouteNamingIssue[] => {
  const allRouteFiles = walkRouteFiles(srcDir);
  const issues: RouteNamingIssue[] = [];

  for (const filePath of allRouteFiles) {
    issues.push(...validateRouteFilePath(filePath));
  }

  return issues.toSorted((a, b) => a.filePath.localeCompare(b.filePath));
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