import path from 'node:path';
import { getSrcDir } from '@luckystack/core';
import { API_VERSION_TOKEN_REGEX, SYNC_VERSION_TOKEN_REGEX } from '../routeConventions';

const VERSION_SUFFIX_REGEX = API_VERSION_TOKEN_REGEX;

const stripVersionSuffix = (name: string): string => {
  // VERSION_SUFFIX_REGEX is anchored (`$`) so it matches at most once — `.replace` is correct here.
  // eslint-disable-next-line unicorn/prefer-string-replace-all
  return name.replace(VERSION_SUFFIX_REGEX, '');
};

const extractVersionFromName = (name: string): string | null => {
  const match = VERSION_SUFFIX_REGEX.exec(name);
  if (!match) return null;
  return `v${match[1]}`;
};

export const extractPagePath = (filePath: string): string => {
  const normalized = filePath.replaceAll('\\', '/');
  // Anchor on the configured srcDir so non-`src` layouts are handled correctly.
  const srcDirNormalized = getSrcDir().replaceAll('\\', '/');
  const rel = path.posix.relative(srcDirNormalized, normalized);
  // If the file is outside the srcDir the relative path starts with '..';
  // throw so callers know this file should not have been discovered.
  if (rel.startsWith('..')) {
    throw new Error(`[routeMeta] file is outside srcDir — cannot extract page path: ${filePath}`);
  }
  const match = /^(?:(.+?)\/)_api\//.exec(rel);
  if (match) {
    return match[1] ?? 'system';
  }
  if (rel.startsWith('_api/')) {
    return 'system';
  }
  return '';
};

export const extractApiName = (filePath: string): string => {
  const normalized = filePath.replaceAll('\\', '/');
  const match = /_api\/(.+)\.ts$/.exec(normalized);
  const rawName = match?.[1] ?? path.basename(filePath, '.ts');
  return stripVersionSuffix(rawName);
};

export const extractApiVersion = (filePath: string): string => {
  const normalized = filePath.replaceAll('\\', '/');
  const match = /_api\/(.+)\.ts$/.exec(normalized);
  const rawName = match?.[1] ?? path.basename(filePath, '.ts');
  return extractVersionFromName(rawName) ?? 'v1';
};

export const extractSyncPagePath = (filePath: string): string => {
  const normalized = filePath.replaceAll('\\', '/');
  //? A sync directly under `src/_sync/` gets the `'system'` sentinel, matching
  //? `extractPagePath` (API side) AND the dev loader's root-sync route key.
  //? Using `'root'` here made the type-map key + generated `FullSyncPath`
  //? (`sync/root/<name>/v1`) disagree with the loader's runtime registration
  //? AND the wire name the typed `syncRequest` actually sends
  //? (`sync/system/<name>/v1`) — so a root sync silently never dispatched.
  const srcDirNormalized = getSrcDir().replaceAll('\\', '/');
  const rel = path.posix.relative(srcDirNormalized, normalized);
  const match = /^(?:(.+?)\/)_sync\//.exec(rel);
  if (match) {
    return match[1] ?? 'system';
  }
  if (rel.startsWith('_sync/')) {
    return 'system';
  }
  return '';
};

export const extractSyncName = (filePath: string): string => {
  const normalized = filePath.replaceAll('\\', '/');
  const match = /_sync\/(.+)\.ts$/.exec(normalized);
  if (!match) {
    const basename = path.basename(filePath, '.ts');
    // SYNC_VERSION_TOKEN_REGEX is anchored (`$`) — matches at most once.
    // eslint-disable-next-line unicorn/prefer-string-replace-all
    return basename.replace(SYNC_VERSION_TOKEN_REGEX, '');
  }

  // eslint-disable-next-line unicorn/prefer-string-replace-all
  return (match[1] ?? '').replace(SYNC_VERSION_TOKEN_REGEX, '');
};

export const extractSyncVersion = (filePath: string): string => {
  const normalized = filePath.replaceAll('\\', '/');
  const match = /_sync\/(.+)\.ts$/.exec(normalized);
  if (!match) {
    const basename = path.basename(filePath, '.ts');
    const versionMatch = SYNC_VERSION_TOKEN_REGEX.exec(basename);
    return versionMatch ? `v${versionMatch[2] ?? '1'}` : 'v1';
  }

  const versionMatch = SYNC_VERSION_TOKEN_REGEX.exec(match[1] ?? '');
  return versionMatch ? `v${versionMatch[2] ?? '1'}` : 'v1';
};
