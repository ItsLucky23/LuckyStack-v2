import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR, getServerFunctionDirs, getSharedDir, getSrcDir } from '@luckystack/core';

import { getOrInit } from './internal/mapUtils';

const SUPPORTED_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts'];

const normalizePath = (value: string): string => path.resolve(value).replaceAll('\\', '/');

const isSupportedScriptFile = (value: string): boolean => {
  return SUPPORTED_EXTENSIONS.some((extension) => value.endsWith(extension));
};

const existsFile = (value: string): boolean => {
  try {
    return fs.existsSync(value) && fs.statSync(value).isFile();
  } catch {
    return false;
  }
};

const existsDirectory = (value: string): boolean => {
  try {
    return fs.existsSync(value) && fs.statSync(value).isDirectory();
  } catch {
    return false;
  }
};

const collectScriptFiles = (dir: string, output: Set<string>): void => {
  if (!existsDirectory(dir)) {
    return;
  }

  const entries = fs.readdirSync(dir);
  for (const entry of entries) {
    const fullPath = path.join(dir, entry);

    if (existsDirectory(fullPath)) {
      collectScriptFiles(fullPath, output);
      continue;
    }

    const normalizedPath = normalizePath(fullPath);
    if (isSupportedScriptFile(normalizedPath)) {
      output.add(normalizedPath);
    }
  }
};

interface CachedSpecifiers {
  mtimeMs: number;
  specifiers: string[];
}

//? Reverse-dependency lookups happen on every file save. Re-reading + regex-
//? parsing every file in src/shared/serverFunctions per save adds tens of ms
//? of synchronous IO. Cache per-file by mtime so unchanged files reuse the
//? prior parse.
const specifiersCache = new Map<string, CachedSpecifiers>();
let scopedFilesCache: { files: Set<string>; expiresAt: number } | null = null;
const SCOPED_FILES_TTL_MS = 1000;

const extractImportSpecifiers = (filePath: string): string[] => {
  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(filePath).mtimeMs;
  } catch {
    specifiersCache.delete(filePath);
    return [];
  }

  const cached = specifiersCache.get(filePath);
  if (cached && cached.mtimeMs === mtimeMs) {
    return cached.specifiers;
  }

  try {
    const source = fs.readFileSync(filePath, 'utf8');
    const specifiers = new Set<string>();

    const importExportRegex = /(?:import|export)\s+(?:[^'"\n]*?\s+from\s+)?['"]([^'"\n]+)['"]/g;
    const dynamicImportRegex = /import\(\s*['"]([^'"\n]+)['"]\s*\)/g;

    let match: RegExpExecArray | null = null;

    while ((match = importExportRegex.exec(source)) !== null) {
      if (match[1]) specifiers.add(match[1]);
    }

    while ((match = dynamicImportRegex.exec(source)) !== null) {
      if (match[1]) specifiers.add(match[1]);
    }

    const result = [...specifiers];
    specifiersCache.set(filePath, { mtimeMs, specifiers: result });
    return result;
  } catch {
    specifiersCache.delete(filePath);
    return [];
  }
};

export const invalidateGraphForFile = (absolutePath: string): void => {
  specifiersCache.delete(normalizePath(absolutePath));
  scopedFilesCache = null;
};

const tryResolveWithExtensions = (basePath: string): string | null => {
  if (existsFile(basePath)) {
    return normalizePath(basePath);
  }

  for (const extension of SUPPORTED_EXTENSIONS) {
    const withExtension = `${basePath}${extension}`;
    if (existsFile(withExtension)) {
      return normalizePath(withExtension);
    }
  }

  if (existsDirectory(basePath)) {
    for (const extension of SUPPORTED_EXTENSIONS) {
      const indexFile = path.join(basePath, `index${extension}`);
      if (existsFile(indexFile)) {
        return normalizePath(indexFile);
      }
    }
  }

  return null;
};

const resolveImportToFile = (importerPath: string, specifier: string): string | null => {
  if (!specifier || specifier.startsWith('node:')) {
    return null;
  }

  if (specifier === 'config') {
    return tryResolveWithExtensions(path.join(ROOT_DIR, 'config'));
  }

  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    const relativeBase = path.resolve(path.dirname(importerPath), specifier);
    return tryResolveWithExtensions(relativeBase);
  }

  if (specifier.startsWith('src/') || specifier.startsWith('@/')) {
    const sourcePath = specifier.startsWith('@/') ? specifier.slice(2) : specifier.slice(4);
    return tryResolveWithExtensions(path.join(getSrcDir(), sourcePath));
  }

  if (specifier.startsWith('shared/')) {
    return tryResolveWithExtensions(path.join(getSharedDir(), specifier.slice(7)));
  }

  return null;
};

const isRouteFile = (filePath: string): boolean => {
  return filePath.includes('/src/') && (filePath.includes('/_api/') || filePath.includes('/_sync/'));
};

const collectScopedFiles = (): Set<string> => {
  const now = Date.now();
  if (scopedFilesCache && scopedFilesCache.expiresAt > now) {
    return scopedFilesCache.files;
  }

  const files = new Set<string>();
  collectScriptFiles(getSrcDir(), files);
  collectScriptFiles(getSharedDir(), files);
  for (const dir of getServerFunctionDirs()) {
    collectScriptFiles(dir, files);
  }

  const configFile = tryResolveWithExtensions(path.join(ROOT_DIR, 'config'));
  if (configFile) {
    files.add(configFile);
  }

  scopedFilesCache = { files, expiresAt: now + SCOPED_FILES_TTL_MS };
  return files;
};

export const findDependentRouteFiles = (changedFilePath: string): Set<string> => {
  const scopedFiles = collectScopedFiles();
  const changedAbsolutePath = normalizePath(changedFilePath);

  const reverseDependencies = new Map<string, Set<string>>();

  for (const filePath of scopedFiles) {
    const specifiers = extractImportSpecifiers(filePath);

    for (const specifier of specifiers) {
      const resolvedImport = resolveImportToFile(filePath, specifier);
      if (!resolvedImport || !scopedFiles.has(resolvedImport)) {
        continue;
      }

      getOrInit(reverseDependencies, resolvedImport, () => new Set<string>()).add(filePath);
    }
  }

  const affectedRoutes = new Set<string>();
  const visited = new Set<string>();
  const queue: string[] = [changedAbsolutePath];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) {
      continue;
    }

    visited.add(current);
    const importers = reverseDependencies.get(current);
    if (!importers) {
      continue;
    }

    for (const importer of importers) {
      if (isRouteFile(importer)) {
        affectedRoutes.add(importer);
      }

      if (!visited.has(importer)) {
        queue.push(importer);
      }
    }
  }

  return affectedRoutes;
};

