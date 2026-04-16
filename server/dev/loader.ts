import fs from "node:fs";
import path from "node:path";
import { createRequire } from 'node:module';
import { tryCatch } from "../functions/tryCatch";
import { getInputTypeFromFile, getSyncClientDataType } from './typeMap/extractors';
import { invalidateProgramCache } from './typeMap/tsProgram';
import { SERVER_FUNCTIONS_DIR, SRC_DIR } from '../utils/paths';
import { clearRuntimeTypeResolverCache } from '../utils/runtimeTypeResolver';

const nodeRequire = createRequire(import.meta.url);

type UnknownRecord = Record<string, unknown>;
type UnknownFunction = (...args: unknown[]) => unknown;

export const devApis: UnknownRecord = {};
export const devSyncs: UnknownRecord = {};
export const devFunctions: UnknownRecord = {};

const API_VERSION_REGEX = /_v(\d+)$/;
const SYNC_VERSION_REGEX = /_(server|client)_v(\d+)$/;

const normalizePath = (value: string): string => value.replaceAll('\\', '/');

const resolveApiRouteMetaFromPath = (filePath: string): { routeKey: string; absolutePath: string } | null => {
  const absolutePath = path.resolve(filePath);
  const normalizedAbsolutePath = normalizePath(absolutePath);
  const normalizedSrcDir = normalizePath(SRC_DIR);

  if (!normalizedAbsolutePath.startsWith(normalizedSrcDir) || !normalizedAbsolutePath.endsWith('.ts')) {
    return null;
  }

  const relativePath = normalizePath(path.relative(SRC_DIR, absolutePath));
  const segments = relativePath.split('/');
  const apiIndex = segments.indexOf('_api');
  if (apiIndex === -1 || apiIndex === segments.length - 1) {
    return null;
  }

  const pageLocation = segments.slice(0, apiIndex).join('/');
  const apiFilePath = segments.slice(apiIndex + 1).join('/');
  const rawApiName = apiFilePath.replace(/\.ts$/, '');
  const versionMatch = API_VERSION_REGEX.exec(rawApiName);

  if (!versionMatch) {
    return null;
  }

  const version = `v${versionMatch[1]}`;
  const apiName = rawApiName.replace(API_VERSION_REGEX, '');
  const routeKey = pageLocation
    ? `api/${pageLocation}/${apiName}/${version}`
    : `api/${apiName}/${version}`;

  return { routeKey, absolutePath };
};

const resolveSyncRouteMetaFromPath = (
  filePath: string,
): { routeKey: string; kind: 'server' | 'client'; absolutePath: string } | null => {
  const absolutePath = path.resolve(filePath);
  const normalizedAbsolutePath = normalizePath(absolutePath);
  const normalizedSrcDir = normalizePath(SRC_DIR);

  if (!normalizedAbsolutePath.startsWith(normalizedSrcDir) || !normalizedAbsolutePath.endsWith('.ts')) {
    return null;
  }

  const relativePath = normalizePath(path.relative(SRC_DIR, absolutePath));
  const segments = relativePath.split('/');
  const syncIndex = segments.indexOf('_sync');
  if (syncIndex === -1 || syncIndex === segments.length - 1) {
    return null;
  }

  const pageLocation = segments.slice(0, syncIndex).join('/');
  const syncFilePath = segments.slice(syncIndex + 1).join('/');
  const rawSyncName = syncFilePath.replace(/\.ts$/, '');
  const match = SYNC_VERSION_REGEX.exec(rawSyncName);

  if (!match) {
    return null;
  }

  const kind = match[1] as 'server' | 'client';
  const version = `v${match[2]}`;
  const syncName = rawSyncName.replace(SYNC_VERSION_REGEX, '');
  const routeBaseKey = pageLocation
    ? `sync/${pageLocation}/${syncName}/${version}`
    : `sync/${syncName}/${version}`;

  return {
    routeKey: `${routeBaseKey}_${kind}`,
    kind,
    absolutePath,
  };
};

export const initializeAll = async () => {
  await Promise.all([initializeApis(), initializeSyncs(), initializeFunctions()]);
};

const toRecord = (value: unknown): UnknownRecord => {
  if (value && typeof value === 'object') {
    return value as UnknownRecord;
  }

  return {};
};

const readBoolean = (value: unknown, fallback: boolean): boolean => {
  return typeof value === 'boolean' ? value : fallback;
};

const readArray = (value: unknown): unknown[] => {
  return Array.isArray(value) ? value : [];
};

const importFile = (absolutePath: string): unknown => {
  const normalizedPath = absolutePath.replaceAll('\\', '/');

  for (const cacheKey of Object.keys(nodeRequire.cache)) {
    const normalizedCacheKey = cacheKey.replaceAll('\\', '/');
    if (normalizedCacheKey.startsWith(normalizedPath)) {
      Reflect.deleteProperty(nodeRequire.cache, cacheKey);
    }
  }

  return nodeRequire(absolutePath);
};

const collectTsFiles = (dir: string, relativeTo = ""): string[] => {
  const results: string[] = [];
  const entries = fs.readdirSync(dir);
  for (const entry of entries) {
    const entryPath = path.join(dir, entry);
    const relPath = relativeTo ? `${relativeTo}/${entry}` : entry;
    if (fs.statSync(entryPath).isDirectory()) {
      results.push(...collectTsFiles(entryPath, relPath));
    } else if (entry.endsWith(".ts")) {
      results.push(relPath);
    }
  }
  return results;
};

const isMergeable = (value: unknown): value is UnknownRecord | UnknownFunction => {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
};

const resolveMergedModule = (loadedModule: unknown): UnknownRecord => {
  const moduleRecord = toRecord(loadedModule);
  const defaultRecord = toRecord(moduleRecord.default);

  if (Object.keys(defaultRecord).length > 0) {
    return {
      ...defaultRecord,
      ...moduleRecord,
    };
  }

  return moduleRecord;
};

const resolveFunctionModule = (loadedModule: unknown, fileName: string): UnknownRecord | UnknownFunction => {
  if (!loadedModule || typeof loadedModule !== 'object' || !("default" in loadedModule)) {
    return isMergeable(loadedModule) ? loadedModule : {};
  }

  const moduleRecord = loadedModule as UnknownRecord;
  const { default: defaultExport, ...namedExports } = moduleRecord;
  const filteredNamedExports = Object.fromEntries(
    Object.entries(namedExports).filter(([key]) => key !== '__esModule')
  );

  if (Object.keys(filteredNamedExports).length > 0) {
    return filteredNamedExports;
  }

  if (defaultExport !== undefined) {
    return { [fileName]: defaultExport };
  }

  return {};
};

export const initializeApis = async () => {
  for (const key of Object.keys(devApis)) {
    Reflect.deleteProperty(devApis, key);
  }
  invalidateProgramCache();
  clearRuntimeTypeResolverCache();
  const srcFolder = fs.readdirSync(SRC_DIR);

  for (const file of srcFolder) {
    await scanApiFolder(file);
  }
};

export const upsertApiFromFile = async (filePath: string): Promise<void> => {
  const routeMeta = resolveApiRouteMetaFromPath(filePath);
  if (!routeMeta) {
    return;
  }

  invalidateProgramCache();
  clearRuntimeTypeResolverCache();

  const [err, module] = await tryCatch(() => importFile(routeMeta.absolutePath));
  if (err) {
    console.log(`[loader][api] failed to import ${routeMeta.routeKey} from ${routeMeta.absolutePath}:`, err, 'red');
    return;
  }

  const resolvedModule = resolveMergedModule(module);
  const auth = toRecord(resolvedModule.auth);
  const main = resolvedModule.main;
  const rateLimit = resolvedModule.rateLimit;
  const httpMethod = resolvedModule.httpMethod;
  const schema = resolvedModule.schema;

  if (!main || typeof main !== 'function') {
    Reflect.deleteProperty(devApis, routeMeta.routeKey);
    return;
  }

  const inputType = getInputTypeFromFile(routeMeta.absolutePath);

  devApis[routeMeta.routeKey] = {
    main,
    auth: {
      login: readBoolean(auth.login, false),
      additional: readArray(auth.additional),
    },
    rateLimit,
    httpMethod,
    schema,
    inputType,
    inputTypeFilePath: routeMeta.absolutePath,
  };
};

export const removeApiFromFile = (filePath: string): void => {
  const routeMeta = resolveApiRouteMetaFromPath(filePath);
  if (!routeMeta) {
    return;
  }

  invalidateProgramCache();
  clearRuntimeTypeResolverCache();
  Reflect.deleteProperty(devApis, routeMeta.routeKey);
};

const scanApiFolder = async (file: string, basePath = "") => {
  const fullPath = path.join(SRC_DIR, basePath, file);
  if (!fs.statSync(fullPath).isDirectory()) return;

  if (!file.toLowerCase().endsWith("api")) {
    const subFolders = fs.readdirSync(fullPath);
    for (const sub of subFolders) {
      await scanApiFolder(sub, path.join(basePath, file));
    }
    return;
  }

  const pageLocation = basePath.replaceAll('\\', '/');
  const tsFiles = collectTsFiles(fullPath);

  for (const relFile of tsFiles) {
    const rawApiName = relFile.replace(/\.ts$/, "").replaceAll('\\', '/');
    const versionMatch = API_VERSION_REGEX.exec(rawApiName);
    if (!versionMatch) {
      continue;
    }

    const version = `v${versionMatch[1]}`;
    const apiName = rawApiName.replace(API_VERSION_REGEX, '');
    const routeKey = pageLocation
      ? `api/${pageLocation}/${apiName}/${version}`
      : `api/${apiName}/${version}`;

    const modulePath = path.resolve(path.join(fullPath, relFile));
    const [err, module] = await tryCatch(() => importFile(modulePath));
    if (err) {
      console.log(`[loader][api] failed to import ${routeKey} from ${modulePath}:`, err, 'red');
      continue;
    }

    const resolvedModule = resolveMergedModule(module);
    const auth = toRecord(resolvedModule.auth);
    const main = resolvedModule.main;
    const rateLimit = resolvedModule.rateLimit;
    const httpMethod = resolvedModule.httpMethod;
    const schema = resolvedModule.schema;
    if (!main || typeof main !== "function") continue;
    const inputType = getInputTypeFromFile(modulePath);

    devApis[routeKey] = {
      main,
      auth: {
        login: readBoolean(auth.login, false),
        additional: readArray(auth.additional),
      },
      rateLimit,
      httpMethod,
      schema,
      inputType,
      inputTypeFilePath: modulePath,
    };
  }
};

export const initializeSyncs = async () => {
  for (const key of Object.keys(devSyncs)) {
    Reflect.deleteProperty(devSyncs, key);
  }
  invalidateProgramCache();
  clearRuntimeTypeResolverCache();
  const srcFolder = fs.readdirSync(SRC_DIR);

  for (const file of srcFolder) {
    await scanSyncFolder(file);
  }
};

export const upsertSyncFromFile = async (filePath: string): Promise<void> => {
  const routeMeta = resolveSyncRouteMetaFromPath(filePath);
  if (!routeMeta) {
    return;
  }

  invalidateProgramCache();
  clearRuntimeTypeResolverCache();

  const [err, module] = await tryCatch(() => importFile(routeMeta.absolutePath));
  if (err) {
    console.log(`[loader][sync] failed to import ${routeMeta.absolutePath}:`, err, 'red');
    return;
  }

  const resolvedSyncModule = resolveMergedModule(module);
  const syncMain = resolvedSyncModule.main;

  if (routeMeta.kind === 'server') {
    if (!syncMain || typeof syncMain !== 'function') {
      Reflect.deleteProperty(devSyncs, routeMeta.routeKey);
      return;
    }

    const inputType = getSyncClientDataType(routeMeta.absolutePath);

    devSyncs[routeMeta.routeKey] = {
      main: syncMain,
      auth: toRecord(resolvedSyncModule.auth),
      inputType,
      inputTypeFilePath: routeMeta.absolutePath,
    };

    return;
  }

  if (!syncMain || typeof syncMain !== 'function') {
    Reflect.deleteProperty(devSyncs, routeMeta.routeKey);
    return;
  }

  devSyncs[routeMeta.routeKey] = syncMain;
};

export const removeSyncFromFile = (filePath: string): void => {
  const routeMeta = resolveSyncRouteMetaFromPath(filePath);
  if (!routeMeta) {
    return;
  }

  invalidateProgramCache();
  clearRuntimeTypeResolverCache();
  Reflect.deleteProperty(devSyncs, routeMeta.routeKey);
};

const scanSyncFolder = async (file: string, basePath = "") => {
  const fullPath = path.join(SRC_DIR, basePath, file);
  if (!fs.statSync(fullPath).isDirectory()) return;

  if (!file.toLowerCase().endsWith("sync")) {
    const subFolders = fs.readdirSync(fullPath);
    for (const sub of subFolders) {
      await scanSyncFolder(sub, path.join(basePath, file));
    }
    return;
  }

  const pageLocation = basePath.replaceAll('\\', '/');
  const tsFiles = collectTsFiles(fullPath);

  for (const relFile of tsFiles) {
    const rawSyncFileName = relFile.replace(/\.ts$/, "").replaceAll('\\', '/');
    const syncMatch = SYNC_VERSION_REGEX.exec(rawSyncFileName);
    if (!syncMatch) {
      continue;
    }

    const kind = syncMatch[1];
    const version = `v${syncMatch[2]}`;
    const syncName = rawSyncFileName.replace(SYNC_VERSION_REGEX, '');
    const routeBaseKey = pageLocation
      ? `sync/${pageLocation}/${syncName}/${version}`
      : `sync/${syncName}/${version}`;

    const filePath = path.resolve(path.join(fullPath, relFile));
    const [fileError, fileResult] = await tryCatch(() => importFile(filePath));
    if (fileError) {
      console.log(`[loader][sync] failed to import ${filePath}:`, fileError, 'red');
      continue;
    }

    const resolvedSyncModule = resolveMergedModule(fileResult);
    const syncMain = resolvedSyncModule.main;
    const inputType = getSyncClientDataType(filePath);

    if (!syncMain || typeof syncMain !== 'function') {
      continue;
    }

    if (kind === 'server') {
      devSyncs[`${routeBaseKey}_server`] = {
        main: syncMain,
        auth: toRecord(resolvedSyncModule.auth),
        inputType,
        inputTypeFilePath: filePath,
      };
    } else {
      devSyncs[`${routeBaseKey}_client`] = syncMain;
    }
  }
};

export const initializeFunctions = async () => {
  for (const key of Object.keys(devFunctions)) {
    Reflect.deleteProperty(devFunctions, key);
  }

  const serverFunctionsDir = SERVER_FUNCTIONS_DIR;
  if (fs.existsSync(serverFunctionsDir)) {
    await scanFunctionsFolder(serverFunctionsDir);
  }
};

const scanFunctionsFolder = async (dir: string, basePath: string[] = []) => {
  const entries = fs.readdirSync(dir);

  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      await scanFunctionsFolder(fullPath, [...basePath, entry]);
      continue;
    }

    if (!entry.endsWith(".ts")) {
      continue;
    }

    const [err, module] = await tryCatch(() => importFile(fullPath));
    if (err) {
      console.log(`[loader][function] failed to import ${fullPath}:`, err, 'red');
      continue;
    }

    const fileName = entry.replace(".ts", "");
    const resolvedFunctionModule = resolveFunctionModule(module, fileName);
    if (!isMergeable(resolvedFunctionModule)) continue;

    let target = devFunctions;
    for (const part of basePath) {
      const nextValue = target[part];
      if (!nextValue || typeof nextValue !== 'object' || Array.isArray(nextValue)) {
        target[part] = {};
      }

      target = target[part] as UnknownRecord;
    }

    if (target[fileName] && isMergeable(resolvedFunctionModule) && isMergeable(target[fileName])) {
      Object.assign(resolvedFunctionModule as UnknownRecord, target[fileName] as UnknownRecord);
    }

    target[fileName] = resolvedFunctionModule;
  }
};

