/* eslint-disable unicorn/no-abusive-eslint-disable */
/* eslint-disable */
import fs from 'fs';
import path from 'path';
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
  results: string[] = []
): string[] => {
  const { ignore } = getRoutingRules();
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = toForwardSlashRelative(fullPath);

      if (ignore(relativePath)) continue;

      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        walkFiles(fullPath, matcher, results);
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
    const normalized = fullPath.replace(/\\/g, '/');
    return isApiFileName(entryName) && normalized.includes(apiSegment);
  });
};

export const findAllSyncServerFiles = (srcDir: string): string[] => {
  const syncSegment = syncMarkerSegment();
  return walkFiles(srcDir, (fullPath, entryName) => {
    const normalized = fullPath.replace(/\\/g, '/');
    return isSyncServerFileName(entryName) && normalized.includes(syncSegment);
  });
};

export const findAllSyncClientFiles = (srcDir: string): string[] => {
  const syncSegment = syncMarkerSegment();
  return walkFiles(srcDir, (fullPath, entryName) => {
    const normalized = fullPath.replace(/\\/g, '/');
    return isSyncClientFileName(entryName) && normalized.includes(syncSegment);
  });
};
