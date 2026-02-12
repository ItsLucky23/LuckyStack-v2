import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { tryCatch } from "../functions/tryCatch";

// ----------------------------
// Storage for loaded modules
// ----------------------------
export const devApis: Record<string, any> = {};
export const devSyncs: Record<string, any> = {};
export const devFunctions: Record<string, any> = {};

// ----------------------------
// Unified Initialization
// ----------------------------
export const initializeAll = async () => {
  await Promise.all([initializeApis(), initializeSyncs(), initializeFunctions()]);
  console.log(devApis)
  console.log(devSyncs)
  console.log("DEV modules initialized.");
  // console.log(devFunctions)
};

// ----------------------------
// Helper: convert absolute path to proper file URL for import
// ----------------------------
const importFile = async (absolutePath: string) => {
  const url = pathToFileURL(absolutePath).href;
  return import(`${url}?update=${Date.now()}`);
};

// ----------------------------
// Helper: recursively collect all .ts files from a directory
// Returns paths relative to the base dir (e.g. "changeName.ts" or "user/changeName.ts")
// ----------------------------
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

// ----------------------------
// API Loader
// ----------------------------
export const initializeApis = async () => {
  Object.keys(devApis).forEach(k => delete devApis[k]);
  const srcFolder = fs.readdirSync(path.resolve("./src"));

  for (const file of srcFolder) {
    await scanApiFolder(file);
  }
};

const scanApiFolder = async (file: string, basePath = "") => {
  const fullPath = path.join("./src", basePath, file);
  if (!fs.statSync(fullPath).isDirectory()) return;

  if (file.toLowerCase().endsWith("api")) {
    // basePath is the path segments between src/ and the _api folder
    // Root _api:     basePath="" → pageLocation=""
    // examples/_api: basePath="examples" → pageLocation="examples"
    const pageLocation = basePath.replace(/\\/g, '/');

    // Collect all .ts files recursively (supports nested folders like _api/user/changeName.ts)
    const tsFiles = collectTsFiles(fullPath);

    for (const relFile of tsFiles) {
      const modulePath = path.resolve(path.join(fullPath, relFile));
      const [err, module] = await tryCatch(async () => importFile(modulePath));
      if (err) continue;

      const { auth = {}, main, rateLimit, httpMethod, schema } = module;
      if (!main || typeof main !== "function") continue;

      // Remove .ts extension and normalize slashes for the API name
      const apiName = relFile.replace(/\.ts$/, "").replace(/\\/g, '/');
      // Build route key: "api/examples/getUserData" or "api/session" (root-level)
      const routeKey = pageLocation ? `api/${pageLocation}/${apiName}` : `api/${apiName}`;

      devApis[routeKey] = {
        main,
        auth: {
          login: auth.login || false,
          additional: auth.additional || [],
        },
        rateLimit,
        httpMethod,
        schema,
      };
    }
  } else {
    const subFolders = fs.readdirSync(fullPath);
    for (const sub of subFolders) {
      await scanApiFolder(sub, path.join(basePath, file));
    }
  }
};

// ----------------------------
// Sync Loader
// ----------------------------
export const initializeSyncs = async () => {
  Object.keys(devSyncs).forEach(k => delete devSyncs[k]);
  const srcFolder = fs.readdirSync(path.resolve("./src"));

  for (const file of srcFolder) {
    await scanSyncFolder(file);
  }
};

const scanSyncFolder = async (file: string, basePath = "") => {
  const fullPath = path.join("./src", basePath, file);
  if (!fs.statSync(fullPath).isDirectory()) return;

  if (file.toLowerCase().endsWith("sync")) {
    // basePath is the path segments between src/ and the _sync folder
    const pageLocation = basePath.replace(/\\/g, '/');

    const files = fs.readdirSync(fullPath);
    for (const f of files) {
      if (!f.endsWith("_client.ts") && !f.endsWith("_server.ts")) { continue; }

      const filePath = path.join(fullPath, f);
      const [fileError, fileResult] = await tryCatch(async () => importFile(filePath));

      if (fileError) { continue; }

      const syncFileName = f.replace(".ts", "");
      // Build route key: "sync/examples/test_server" or "sync/test_server" (root-level)
      const routeKey = pageLocation ? `sync/${pageLocation}/${syncFileName}` : `sync/${syncFileName}`;

      if (f.endsWith("_server.ts")) {
        devSyncs[routeKey] = { 
          main: fileResult.main, 
          auth: fileResult.auth || {} 
        };
      } else {
        devSyncs[routeKey] = fileResult.main;
      }
    }
  } else {
    const subFolders = fs.readdirSync(fullPath);
    for (const sub of subFolders) {
      await scanSyncFolder(sub, path.join(basePath, file));
    }
  }
};

// ----------------------------
// Functions Loader
// ----------------------------
export const initializeFunctions = async () => {
  Object.keys(devFunctions).forEach(k => delete devFunctions[k]);
  const functionsFolder = fs.readdirSync(path.resolve("./server/functions"));

  for (const file of functionsFolder) {
    const filePath = path.join("./server/functions", file);
    if (!fs.statSync(filePath).isFile() || !file.endsWith(".ts")) continue;

    const [err, module] = await tryCatch(async () => importFile(filePath));
    if (err) continue;


    Object.assign(devFunctions, module);
  }
};