import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from '@luckystack/core';
import {
  getRoutingRules,
  isApiFileName,
  isSyncClientFileName,
  isSyncServerFileName,
  apiMarkerSegment,
  syncMarkerSegment,
} from '../routingRules';

const toForwardSlashRelative = (absolute: string): string => {
  const rel = path.relative(ROOT_DIR, absolute);
  return rel.replaceAll('\\', '/');
};

const walkFiles = (
  dir: string,
  matcher: (fullPath: string, entryName: string) => boolean,
  results: string[] = [],
  visited = new Set<string>()
): string[] => {
  // Resolve the real path to detect symlink cycles before descending.
  let realDir: string;
  try {
    realDir = fs.realpathSync(dir);
  } catch {
    return results;
  }
  if (visited.has(realDir)) return results;
  visited.add(realDir);

  const { ignore } = getRoutingRules();
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = toForwardSlashRelative(fullPath);

      if (ignore(relativePath)) continue;

      if (entry.isDirectory() || entry.isSymbolicLink()) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        // Only recurse if this is actually a directory (resolves symlinks).
        try {
          if (fs.statSync(fullPath).isDirectory()) {
            walkFiles(fullPath, matcher, results, visited);
          }
        } catch {
          // Broken symlink — skip.
        }
        continue;
      }

      if (entry.isFile() && matcher(fullPath, entry.name)) {
        results.push(fullPath);
      }
    }
  } catch (error) {
    console.error(`[TypeMapDiscovery] Error scanning directory ${dir}:`, error);
  }

  return results;
};

export const findAllApiFiles = (srcDir: string): string[] => {
  const apiSegment = apiMarkerSegment();
  return walkFiles(srcDir, (fullPath, entryName) => {
    const normalized = fullPath.replaceAll('\\', '/');
    return isApiFileName(entryName) && normalized.includes(apiSegment);
  });
};

export const findAllSyncServerFiles = (srcDir: string): string[] => {
  const syncSegment = syncMarkerSegment();
  return walkFiles(srcDir, (fullPath, entryName) => {
    const normalized = fullPath.replaceAll('\\', '/');
    return isSyncServerFileName(entryName) && normalized.includes(syncSegment);
  });
};

export const findAllSyncClientFiles = (srcDir: string): string[] => {
  const syncSegment = syncMarkerSegment();
  return walkFiles(srcDir, (fullPath, entryName) => {
    const normalized = fullPath.replaceAll('\\', '/');
    return isSyncClientFileName(entryName) && normalized.includes(syncSegment);
  });
};
