import fs from 'fs';
import path from 'path';

const walkFiles = (
  dir: string,
  matcher: (fullPath: string, entryName: string) => boolean,
  results: string[] = []
): string[] => {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

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
  return walkFiles(srcDir, (fullPath, entryName) => {
    const normalized = fullPath.replace(/\\/g, '/');
    return /_v\d+\.ts$/.test(entryName) && normalized.includes('/_api/');
  });
};

export const findAllSyncServerFiles = (srcDir: string): string[] => {
  return walkFiles(srcDir, (fullPath, entryName) => {
    const normalized = fullPath.replace(/\\/g, '/');
    return /_server_v\d+\.ts$/.test(entryName) && normalized.includes('/_sync/');
  });
};

export const findAllSyncClientFiles = (srcDir: string): string[] => {
  return walkFiles(srcDir, (fullPath, entryName) => {
    const normalized = fullPath.replace(/\\/g, '/');
    return /_client_v\d+\.ts$/.test(entryName) && normalized.includes('/_sync/');
  });
};
