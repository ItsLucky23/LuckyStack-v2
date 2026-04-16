import path from 'node:path';

const VERSION_SUFFIX_REGEX = /_v(\d+)$/;

const stripVersionSuffix = (name: string): string => {
  return name.replace(VERSION_SUFFIX_REGEX, '');
};

const extractVersionFromName = (name: string): string | null => {
  const match = VERSION_SUFFIX_REGEX.exec(name);
  if (!match) return null;
  return `v${match[1]}`;
};

export const extractPagePath = (filePath: string): string => {
  const normalized = filePath.replaceAll('\\', '/');
  const match = /src\/(?:(.+?)\/)_api\//.exec(normalized);
  if (match) {
    return match[1] || 'root';
  }
  if (normalized.includes('/src/_api/')) {
    return 'root';
  }
  return '';
};

export const extractApiName = (filePath: string): string => {
  const normalized = filePath.replaceAll('\\', '/');
  const match = /_api\/(.+)\.ts$/.exec(normalized);
  const rawName = match ? match[1] : path.basename(filePath, '.ts');
  return stripVersionSuffix(rawName);
};

export const extractApiVersion = (filePath: string): string => {
  const normalized = filePath.replaceAll('\\', '/');
  const match = /_api\/(.+)\.ts$/.exec(normalized);
  const rawName = match ? match[1] : path.basename(filePath, '.ts');
  return extractVersionFromName(rawName) || 'v1';
};

export const extractSyncPagePath = (filePath: string): string => {
  const normalized = filePath.replaceAll('\\', '/');
  const match = /src\/(?:(.+?)\/)_sync\//.exec(normalized);
  if (match) {
    return match[1] || 'root';
  }
  if (normalized.includes('/src/_sync/')) {
    return 'root';
  }
  return '';
};

export const extractSyncName = (filePath: string): string => {
  const normalized = filePath.replaceAll('\\', '/');
  const match = /_sync\/(.+)\.ts$/.exec(normalized);
  if (!match) {
    const basename = path.basename(filePath, '.ts');
    const rawName = basename
      .replace(/_server_v\d+$/, '')
      .replace(/_client_v\d+$/, '');
    return rawName;
  }

  const rawName = match[1]
    .replace(/_server_v\d+$/, '')
    .replace(/_client_v\d+$/, '');

  return rawName;
};

export const extractSyncVersion = (filePath: string): string => {
  const normalized = filePath.replaceAll('\\', '/');
  const match = /_sync\/(.+)\.ts$/.exec(normalized);
  if (!match) {
    const basename = path.basename(filePath, '.ts');
    const versionMatch = /_(?:server|client)_v(\d+)$/.exec(basename);
    return versionMatch ? `v${versionMatch[1]}` : 'v1';
  }

  const versionMatch = /_(?:server|client)_v(\d+)$/.exec(match[1]);
  return versionMatch ? `v${versionMatch[1]}` : 'v1';
};
