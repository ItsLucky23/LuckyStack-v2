/* eslint-disable unicorn/no-abusive-eslint-disable */
/* eslint-disable */
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
    return match[1] || 'system';
  }
  if (normalized.includes('/src/_api/')) {
    return 'system';
  }
  return '';
};

export const extractApiName = (filePath: string): string => {
  const normalized = filePath.replace(/\\/g, '/');
  const match = normalized.match(/_api\/(.+)\.ts$/);
  const rawName = match?.[1] ?? path.basename(filePath, '.ts');
  return stripVersionSuffix(rawName);
};

export const extractApiVersion = (filePath: string): string => {
  const normalized = filePath.replace(/\\/g, '/');
  const match = normalized.match(/_api\/(.+)\.ts$/);
  const rawName = match?.[1] ?? path.basename(filePath, '.ts');
  return extractVersionFromName(rawName) || 'v1';
};

export const extractSyncPagePath = (filePath: string): string => {
  const normalized = filePath.replace(/\\/g, '/');
  //? A sync directly under `src/_sync/` gets the `'system'` sentinel, matching
  //? `extractPagePath` (API side) AND the dev loader's root-sync route key.
  //? Using `'root'` here made the type-map key + generated `FullSyncPath`
  //? (`sync/root/<name>/v1`) disagree with the loader's runtime registration
  //? AND the wire name the typed `syncRequest` actually sends
  //? (`sync/system/<name>/v1`) — so a root sync silently never dispatched.
  const match = normalized.match(/src\/(?:(.+?)\/)_sync\//);
  if (match) {
    return match[1] || 'system';
  }
  if (normalized.includes('/src/_sync/')) {
    return 'system';
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

  const rawName = (match[1] ?? '')
    .replace(SYNC_VERSION_TOKEN_REGEX, '');

  return rawName;
};

export const extractSyncVersion = (filePath: string): string => {
  const normalized = filePath.replace(/\\/g, '/');
  const match = normalized.match(/_sync\/(.+)\.ts$/);
  if (!match) {
    const basename = path.basename(filePath, '.ts');
    const versionMatch = basename.match(SYNC_VERSION_TOKEN_REGEX);
    return versionMatch ? `v${versionMatch[2] ?? '1'}` : 'v1';
  }

  const versionMatch = (match[1] ?? '').match(SYNC_VERSION_TOKEN_REGEX);
  return versionMatch ? `v${versionMatch[2] ?? '1'}` : 'v1';
};