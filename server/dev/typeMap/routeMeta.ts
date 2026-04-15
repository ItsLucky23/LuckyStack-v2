import path from 'path';
import { API_VERSION_TOKEN_REGEX, SYNC_VERSION_TOKEN_REGEX } from '../routeConventions';

const VERSION_SUFFIX_REGEX = API_VERSION_TOKEN_REGEX;

const stripVersionSuffix = (name: string): string => {
  return name.replace(VERSION_SUFFIX_REGEX, '');
};

const extractVersionFromName = (name: string): string | null => {
  const match = name.match(VERSION_SUFFIX_REGEX);
  if (!match) return null;
  return `v${match[1]}`;
};

export const extractPagePath = (filePath: string): string => {
  const normalized = filePath.replace(/\\/g, '/');
  const match = normalized.match(/src\/(?:(.+?)\/)_api\//);
  if (match) {
    return match[1] || 'root';
  }
  if (normalized.includes('/src/_api/')) {
    return 'root';
  }
  return '';
};

export const extractApiName = (filePath: string): string => {
  const normalized = filePath.replace(/\\/g, '/');
  const match = normalized.match(/_api\/(.+)\.ts$/);
  const rawName = match ? match[1] : path.basename(filePath, '.ts');
  return stripVersionSuffix(rawName);
};

export const extractApiVersion = (filePath: string): string => {
  const normalized = filePath.replace(/\\/g, '/');
  const match = normalized.match(/_api\/(.+)\.ts$/);
  const rawName = match ? match[1] : path.basename(filePath, '.ts');
  return extractVersionFromName(rawName) || 'v1';
};

export const extractSyncPagePath = (filePath: string): string => {
  const normalized = filePath.replace(/\\/g, '/');
  const match = normalized.match(/src\/(?:(.+?)\/)_sync\//);
  if (match) {
    return match[1] || 'root';
  }
  if (normalized.includes('/src/_sync/')) {
    return 'root';
  }
  return '';
};

export const extractSyncName = (filePath: string): string => {
  const normalized = filePath.replace(/\\/g, '/');
  const match = normalized.match(/_sync\/(.+)\.ts$/);
  if (!match) {
    const basename = path.basename(filePath, '.ts');
    const rawName = basename
      .replace(SYNC_VERSION_TOKEN_REGEX, '');
    return rawName;
  }

  const rawName = match[1]
    .replace(SYNC_VERSION_TOKEN_REGEX, '');

  return rawName;
};

export const extractSyncVersion = (filePath: string): string => {
  const normalized = filePath.replace(/\\/g, '/');
  const match = normalized.match(/_sync\/(.+)\.ts$/);
  if (!match) {
    const basename = path.basename(filePath, '.ts');
    const versionMatch = basename.match(SYNC_VERSION_TOKEN_REGEX);
    return versionMatch ? `v${versionMatch[2]}` : 'v1';
  }

  const versionMatch = match[1].match(SYNC_VERSION_TOKEN_REGEX);
  return versionMatch ? `v${versionMatch[2]}` : 'v1';
};