/* eslint-disable unicorn/no-abusive-eslint-disable */
/* eslint-disable */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from 'node:url';
import { tryCatch, getServerFunctionDirs, getSrcDir } from '@luckystack/core';
import { getInputTypeFromFile, getSyncClientDataType } from './typeMap/extractors';
import { invalidateProgramCache } from './typeMap/tsProgram';
import { clearRuntimeTypeResolverCache } from './runtimeTypeResolver';
import { getRoutingRules } from './routingRules';
import { assertValidRouteNaming } from './routeNamingValidation';

export const devApis: Record<string, unknown> = {};
export const devSyncs: Record<string, unknown> = {};
export const devFunctions: Record<string, unknown> = {};

const normalizePath = (value: string): string => value.replaceAll('\\', '/');

const mapApiPageLocation = (pageLocation: string): string => {
  return pageLocation ? pageLocation : 'system';
};

const resolveApiRouteMetaFromPath = (filePath: string): { routeKey: string; absolutePath: string } | null => {
  const absolutePath = path.resolve(filePath);
  const normalizedAbsolutePath = normalizePath(absolutePath);
  const normalizedSrcDir = normalizePath(getSrcDir());

  if (!normalizedAbsolutePath.startsWith(normalizedSrcDir) || !normalizedAbsolutePath.endsWith('.ts')) {
    return null;
  }

  const rules = getRoutingRules();
  const relativePath = normalizePath(path.relative(getSrcDir(), absolutePath));
  const segments = relativePath.split('/');
  const apiIndex = segments.indexOf(rules.apiMarker);
  if (apiIndex === -1 || apiIndex === segments.length - 1) {
    return null;
  }

  const pageLocation = segments.slice(0, apiIndex).join('/');
  const apiFilePath = segments.slice(apiIndex + 1).join('/');
  const rawApiName = apiFilePath.replace(/\.ts$/, '');
  const versionMatch = rawApiName.match(rules.apiVersionRegex);

  if (!versionMatch) {
    return null;
  }

  const version = `v${versionMatch[1]}`;
  const apiName = rawApiName.replace(rules.apiVersionRegex, '');
  const mappedPageLocation = mapApiPageLocation(pageLocation);
  const routeKey = `api/${mappedPageLocation}/${apiName}/${version}`;

  return { routeKey, absolutePath };
};

const resolveSyncRouteMetaFromPath = (
  filePath: string,
): { routeKey: string; kind: 'server' | 'client'; absolutePath: string } | null => {
  const absolutePath = path.resolve(filePath);
  const normalizedAbsolutePath = normalizePath(absolutePath);
  const normalizedSrcDir = normalizePath(getSrcDir());

  if (!normalizedAbsolutePath.startsWith(normalizedSrcDir) || !normalizedAbsolutePath.endsWith('.ts')) {
    return null;
  }

  const rules = getRoutingRules();
  const relativePath = normalizePath(path.relative(getSrcDir(), absolutePath));
  const segments = relativePath.split('/');
  const syncIndex = segments.indexOf(rules.syncMarker);
  if (syncIndex === -1 || syncIndex === segments.length - 1) {
    return null;
  }

  const pageLocation = segments.slice(0, syncIndex).join('/');
  const syncFilePath = segments.slice(syncIndex + 1).join('/');
  const rawSyncName = syncFilePath.replace(/\.ts$/, '');
  const match = rawSyncName.match(rules.syncVersionRegex);

  if (!match) {
    return null;
  }

  const kind = match[1] as 'server' | 'client';
  const version = `v${match[2]}`;
  const syncName = rawSyncName.replace(rules.syncVersionRegex, '');
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
  assertValidRouteNaming({
    srcDir: getSrcDir(),
    context: 'starting dev server (npm run server)',
  });

  await Promise.all([initializeApis(), initializeSyncs(), initializeFunctions()]);
};

// Dev hot-reload uses dynamic `import()` so module load yields to the event
// loop instead of blocking it the way CommonJS `require()` did. The `?v=...`
// query is a cachebust so the ESM loader returns a fresh evaluation each save.
const importFile = async (absolutePath: string) => {
  const url = `${pathToFileURL(absolutePath).href}?v=${Date.now()}`;
  return import(url);
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

const isMergeable = (value: unknown): value is Record<string, unknown> | ((...args: unknown[]) => unknown) => {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
};

const resolveFunctionModule = (loadedModule: unknown, fileName: string) => {
  if (!loadedModule || typeof loadedModule !== 'object' || !("default" in loadedModule)) {
    return isMergeable(loadedModule) ? loadedModule : {};
  }

  const moduleRecord = loadedModule as Record<string, unknown>;
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
  for (const key of Object.keys(devApis)) delete devApis[key];
  //? No invalidateProgramCache() here — cachedProgram starts as null on
  //? module-load (tsProgram.ts), so the first getServerProgram() call
  //? builds it from scratch. With initializeApis + initializeSyncs running
  //? in parallel via Promise.all, invalidating here forced a redundant
  //? double-build (~3-4s waste). Hot-reload paths (upsertApiFromFile,
  //? removeApiFromFile etc.) DO invalidate — that's where it's needed.
  clearRuntimeTypeResolverCache();
  const srcFolder = fs.readdirSync(getSrcDir());

  for (const file of srcFolder) {
    await scanApiFolder(file);
  }
};

export const upsertApiFromFile = async (filePath: string): Promise<void> => {
  const routeMeta = resolveApiRouteMetaFromPath(filePath);
  if (!routeMeta) {
    const normalized = normalizePath(path.resolve(filePath));
    if (normalized.includes('/_api/') && normalized.endsWith('.ts')) {
      console.log(
        `[loader][api] invalid filename: ${normalized}. Expected <name>_v<number>.ts. File will not be loaded.`,
        'red'
      );
    }
    return;
  }

  invalidateProgramCache();
  clearRuntimeTypeResolverCache();

  const [err, module] = await tryCatch(async () => importFile(routeMeta.absolutePath));
  if (err) {
    console.log(`[loader][api] failed to import ${routeMeta.routeKey} from ${routeMeta.absolutePath}:`, err, 'red');
    return;
  }

  const resolvedModule = module?.default ? { ...module.default, ...module } : module;
  const { auth = {}, main, rateLimit, httpMethod, schema } = resolvedModule;

  if (!main || typeof main !== 'function') {
    delete devApis[routeMeta.routeKey];
    return;
  }

  const inputType = getInputTypeFromFile(routeMeta.absolutePath);

  devApis[routeMeta.routeKey] = {
    main,
    auth: {
      login: auth.login || false,
      additional: auth.additional || [],
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
  delete devApis[routeMeta.routeKey];
};

const scanApiFolder = async (file: string, basePath = "") => {
  const fullPath = path.join(getSrcDir(), basePath, file);
  if (!fs.statSync(fullPath).isDirectory()) return;

  if (!file.toLowerCase().endsWith("api")) {
    const subFolders = fs.readdirSync(fullPath);
    for (const sub of subFolders) {
      await scanApiFolder(sub, path.join(basePath, file));
    }
    return;
  }

  const pageLocation = basePath.replaceAll('\\', '/');
  const mappedPageLocation = mapApiPageLocation(pageLocation);
  const tsFiles = collectTsFiles(fullPath);

  const apiRules = getRoutingRules();
  for (const relFile of tsFiles) {
    const rawApiName = relFile.replace(/\.ts$/, "").replaceAll('\\', '/');
    const versionMatch = rawApiName.match(apiRules.apiVersionRegex);
    if (!versionMatch) {
      console.log(
        `[loader][api] invalid filename: ${path.join(fullPath, relFile)}. Expected <name>_v<number>.ts. File will not be loaded.`,
        'red'
      );
      continue;
    }

    const version = `v${versionMatch[1]}`;
    const apiName = rawApiName.replace(apiRules.apiVersionRegex, '');
    const routeKey = `api/${mappedPageLocation}/${apiName}/${version}`;

    const modulePath = path.resolve(path.join(fullPath, relFile));
    const [err, module] = await tryCatch(async () => importFile(modulePath));
    if (err) {
      console.log(`[loader][api] failed to import ${routeKey} from ${modulePath}:`, err, 'red');
      continue;
    }

    const resolvedModule = module?.default ? { ...module.default, ...module } : module;
    const { auth = {}, main, rateLimit, httpMethod, schema } = resolvedModule;
    if (!main || typeof main !== "function") continue;
    const inputType = getInputTypeFromFile(modulePath);

    devApis[routeKey] = {
      main,
      auth: {
        login: auth.login || false,
        additional: auth.additional || [],
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
  for (const key of Object.keys(devSyncs)) delete devSyncs[key];
  //? See initializeApis above — no invalidation on the boot path. Hot-reload
  //? paths (upsertSyncFromFile / removeSyncFromFile) handle invalidation
  //? when a file actually changes.
  clearRuntimeTypeResolverCache();
  const srcFolder = fs.readdirSync(getSrcDir());

  for (const file of srcFolder) {
    await scanSyncFolder(file);
  }
};

export const upsertSyncFromFile = async (filePath: string): Promise<void> => {
  const routeMeta = resolveSyncRouteMetaFromPath(filePath);
  if (!routeMeta) {
    const normalized = normalizePath(path.resolve(filePath));
    if (normalized.includes(`/${getRoutingRules().syncMarker}/`) && normalized.endsWith('.ts')) {
      console.log(
        `[loader][sync] invalid filename: ${normalized}. Expected <name>_server_v<number>.ts or <name>_client_v<number>.ts. File will not be loaded.`,
        'red'
      );
    }
    return;
  }

  invalidateProgramCache();
  clearRuntimeTypeResolverCache();

  const [err, module] = await tryCatch(async () => importFile(routeMeta.absolutePath));
  if (err) {
    console.log(`[loader][sync] failed to import ${routeMeta.absolutePath}:`, err, 'red');
    return;
  }

  const resolvedSyncModule = module?.default
    ? { ...module.default, ...module }
    : module;

  if (routeMeta.kind === 'server') {
    if (!resolvedSyncModule.main || typeof resolvedSyncModule.main !== 'function') {
      delete devSyncs[routeMeta.routeKey];
      return;
    }

    const inputType = getSyncClientDataType(routeMeta.absolutePath);

    devSyncs[routeMeta.routeKey] = {
      main: resolvedSyncModule.main,
      auth: resolvedSyncModule.auth || {},
      inputType,
      inputTypeFilePath: routeMeta.absolutePath,
    };

    return;
  }

  if (!resolvedSyncModule.main || typeof resolvedSyncModule.main !== 'function') {
    delete devSyncs[routeMeta.routeKey];
    return;
  }

  devSyncs[routeMeta.routeKey] = resolvedSyncModule.main;
};

export const removeSyncFromFile = (filePath: string): void => {
  const routeMeta = resolveSyncRouteMetaFromPath(filePath);
  if (!routeMeta) {
    return;
  }

  invalidateProgramCache();
  clearRuntimeTypeResolverCache();
  delete devSyncs[routeMeta.routeKey];
};

const scanSyncFolder = async (file: string, basePath = "") => {
  const fullPath = path.join(getSrcDir(), basePath, file);
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

  const syncRules = getRoutingRules();
  for (const relFile of tsFiles) {
    const rawSyncFileName = relFile.replace(/\.ts$/, "").replaceAll('\\', '/');
    const syncMatch = rawSyncFileName.match(syncRules.syncVersionRegex);
    if (!syncMatch) {
      console.log(
        `[loader][sync] invalid filename: ${path.join(fullPath, relFile)}. Expected <name>_server_v<number>.ts or <name>_client_v<number>.ts. File will not be loaded.`,
        'red'
      );
      continue;
    }

    const kind = syncMatch[1];
    const version = `v${syncMatch[2]}`;
    const syncName = rawSyncFileName.replace(syncRules.syncVersionRegex, '');
    const routeBaseKey = pageLocation
      ? `sync/${pageLocation}/${syncName}/${version}`
      : `sync/${syncName}/${version}`;

    const filePath = path.resolve(path.join(fullPath, relFile));
    const [fileError, fileResult] = await tryCatch(async () => importFile(filePath));
    if (fileError) {
      console.log(`[loader][sync] failed to import ${filePath}:`, fileError, 'red');
      continue;
    }

    const resolvedSyncModule = fileResult?.default
      ? { ...fileResult.default, ...fileResult }
      : fileResult;
    const inputType = getSyncClientDataType(filePath);

    if (kind === 'server') {
      devSyncs[`${routeBaseKey}_server`] = {
        main: resolvedSyncModule.main,
        auth: resolvedSyncModule.auth || {},
        inputType,
        inputTypeFilePath: filePath,
      };
    } else {
      devSyncs[`${routeBaseKey}_client`] = resolvedSyncModule.main;
    }
  }
};

//? Tracks which root directory claimed each key-path so we can detect
//? cross-root collisions (e.g. `functions/sleep.ts` AND `shared/sleep.ts`)
//? and surface the same error the codegen emits, instead of silently
//? merging exports across roots.
const functionClaimMap = new Map<string, string>();

export const initializeFunctions = async () => {
  for (const key of Object.keys(devFunctions)) delete devFunctions[key];
  functionClaimMap.clear();

  const dirs = getServerFunctionDirs();
  for (const dir of dirs) {
    if (fs.existsSync(dir)) {
      await scanFunctionsFolder(dir, dir);
    }
  }
};

const scanFunctionsFolder = async (dir: string, rootDir: string, basePath: string[] = []) => {
  const entries = fs.readdirSync(dir);

  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      await scanFunctionsFolder(fullPath, rootDir, [...basePath, entry]);
      continue;
    }

    if (!entry.endsWith(".ts")) {
      continue;
    }

    const [err, module] = await tryCatch(async () => importFile(fullPath));
    if (err) {
      console.log(`[loader][function] failed to import ${fullPath}:`, err, 'red');
      continue;
    }

    const fileName = entry.replace(".ts", "");
    const resolvedFunctionModule = resolveFunctionModule(module, fileName);
    if (!isMergeable(resolvedFunctionModule)) continue;

    const keyPath = [...basePath, fileName].join('.');
    const previousRoot = functionClaimMap.get(keyPath);
    if (previousRoot !== undefined && previousRoot !== rootDir) {
      //? Cross-root collision. Mirror the codegen-time error so dev mode
      //? surfaces the same diagnostic. Skip the import so the previous
      //? claim wins; the next type-map regen will fail the build with the
      //? full message.
      console.log(
        `[loader][function] Conflict at \`functions.${keyPath}\`: defined in both \`${previousRoot}\` and \`${rootDir}\`. Skipping the second copy; fix the duplicate (delete one — \`shared/\` is the canonical location for framework re-exports).`,
        'red',
      );
      continue;
    }
    functionClaimMap.set(keyPath, rootDir);

    //? Walk into devFunctions tree, creating nested Record<string, unknown>
    //? subtrees on demand. Each level is structurally a record but typed as
    //? `unknown` after one level of indexing — re-narrow before descent.
    let target: Record<string, unknown> = devFunctions;
    for (const part of basePath) {
      const existing = target[part];
      if (!existing || typeof existing !== 'object') {
        target[part] = {};
      }
      target = target[part] as Record<string, unknown>;
    }

    const existingAtFileName = target[fileName];
    if (
      existingAtFileName !== undefined
      && isMergeable(resolvedFunctionModule)
      && isMergeable(existingAtFileName)
    ) {
      Object.assign(resolvedFunctionModule, existingAtFileName);
    }

    target[fileName] = resolvedFunctionModule;
  }
};
